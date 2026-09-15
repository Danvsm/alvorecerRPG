import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const migrations = [
  "001_core.sql",
  "002_accounts.sql",
  "20260911201143_resources_consumables_shops.sql",
  "20260912053818_storage_inventory_indexes.sql",
  "20260912074700_avatar_gallery_master_account_dracmas.sql",
  "20260912093716_avatar_dracmas_fk_indexes.sql",
  "20260912113000_profiles_wallet_activity_lifecycle.sql",
  "20260912140000_history_safe_deletions.sql",
  "20260912150000_security_performance_hardening.sql",
  "20260913053717_progression_rules.sql",
  "20260913054245_identity_admin_social.sql",
  "20260913055244_social_messages.sql",
  "20260913104642_reward_notifications.sql",
  "20260913104835_player_data_admin.sql",
  "20260913105307_temporary_chat_media.sql",
  "20260913110117_profile_combat_polish.sql",
  "20260913164608_identity_lifecycle_guard.sql",
  "20260915043804_delete_world_characters.sql",
  "20260915061954_fix_world_character_storage_deletion.sql",
  "20260915151114_avatar_usage_administration.sql",
];

const migration = async (name: string) =>
  (
    await readFile(
      new URL(`../supabase/migrations/${name}`, import.meta.url),
      "utf8",
    )
  )
    .replace("create extension if not exists pgcrypto;", "")
    .replace(
      "alter publication supabase_realtime add table public.campaign_events;",
      "",
    );

test("avatar use and administration remain atomic and server-enforced", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role bypassrls;
      create schema auth;
      create table auth.users(id uuid primary key,email text,encrypted_password text);
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
      $$;
      grant usage on schema public,auth to anon,authenticated,service_role;
      create schema storage;
      create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(name text primary key,bucket_id text);
      alter table storage.objects enable row level security;
      create function storage.foldername(path text) returns text[] language sql immutable as $$
        select string_to_array(regexp_replace(path,'/[^/]+$',''),'/')
      $$;
      create function storage.extension(path text) returns text language sql immutable as $$
        select split_part(path,'.',2)
      $$;
      grant usage on schema storage to authenticated;
      grant select,insert,delete on storage.objects to authenticated;
      insert into storage.buckets values('portraits','portraits',false,262144,array['image/webp']);
    `);
    for (const file of migrations) await db.exec(await migration(file));

    const [master, playerA, playerB] = (
      await db.query<{ id: string }>(
        "insert into auth.users(id) values(gen_random_uuid()),(gen_random_uuid()),(gen_random_uuid()) returning id",
      )
    ).rows.map((row) => row.id);
    const campaign = (
      await db.query<{ id: string }>(
        "select bootstrap_campaign($1,'pink','pink@invalid','cipher') id",
        [master],
      )
    ).rows[0].id;
    const createPlayer = async (user: string, username: string) =>
      (
        await db.query<{ id: string }>(
          "select provision_player($1,$2,$3,$4,'cipher',$5::jsonb,null,$6) id",
          [
            campaign,
            user,
            username,
            `${username}@invalid`,
            JSON.stringify({ name: username, xp: 100 }),
            master,
          ],
        )
      ).rows[0].id;
    const characterA = await createPlayer(playerA, "gabriel");
    const characterB = await createPlayer(playerB, "maria");

    const asUser = async (user: string) => {
      await db.exec("reset role");
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
        user,
      ]);
      await db.exec("set role authenticated");
    };
    const gameAction = (operation: string, data: object) =>
      db.query("select game_action($1,$2,$3::jsonb)", [
        campaign,
        operation,
        JSON.stringify(data),
      ]);
    const identityAction = (operation: string, data: object) =>
      db.query("select identity_action($1,$2,$3::jsonb)", [
        campaign,
        operation,
        JSON.stringify(data),
      ]);
    const adminAvatar = async (
      avatar: string,
      operation: string,
      exclusiveUser?: string,
    ) => {
      await db.exec("reset role; set role service_role");
      try {
        await db.query("select admin_avatar_action($1,$2,$3,$4,$5)", [
          campaign,
          avatar,
          master,
          operation,
          exclusiveUser || null,
        ]);
      } finally {
        await db.exec("reset role");
      }
    };

    await asUser(master);
    for (const name of ["Alpha", "Beta", "Gamma", "Delta", "Epsilon"])
      await gameAction("avatar", {
        name,
        storage_path: `${campaign}/avatars/${name.toLowerCase()}.webp`,
      });
    await db.exec("reset role");
    const avatars = Object.fromEntries(
      (
        await db.query<{ id: string; name: string }>(
          "select id,name from campaign_avatars where campaign_id=$1",
          [campaign],
        )
      ).rows.map((avatar) => [avatar.name, avatar.id]),
    );
    const identityA = (
      await db.query<{ id: string }>(
        "select id from social_identities where campaign_id=$1 and user_id=$2",
        [campaign, playerA],
      )
    ).rows[0].id;
    const identityB = (
      await db.query<{ id: string }>(
        "select id from social_identities where campaign_id=$1 and user_id=$2",
        [campaign, playerB],
      )
    ).rows[0].id;
    const masterIdentity = (
      await db.query<{ id: string }>(
        "select id from social_identities where campaign_id=$1 and user_id=$2",
        [campaign, master],
      )
    ).rows[0].id;

    await asUser(playerA);
    await identityAction("avatar", {
      identity_id: identityA,
      avatar_id: avatars.Alpha,
    });
    await asUser(master);
    const alphaInUse = (
      await db.query<{ state: string; usage: Array<{ username: string }> }>(
        "select state,usage from avatar_catalog($1) where id=$2",
        [campaign, avatars.Alpha],
      )
    ).rows[0];
    assert.equal(alphaInUse.state, "in_use");
    assert.deepEqual(
      alphaInUse.usage.map((entry) => entry.username),
      ["gabriel"],
    );

    await asUser(playerB);
    await assert.rejects(
      identityAction("avatar", {
        identity_id: identityB,
        avatar_id: avatars.Alpha,
      }),
      /Avatar já está em uso/,
    );
    await assert.rejects(
      gameAction("avatar_select", {
        character_id: characterB,
        avatar_id: avatars.Alpha,
      }),
      /Avatar já está em uso/,
    );

    await asUser(playerA);
    await identityAction("avatar", {
      identity_id: identityA,
      avatar_id: avatars.Beta,
    });
    await asUser(master);
    assert.equal(
      (
        await db.query<{ state: string }>(
          "select state from avatar_catalog($1) where id=$2",
          [campaign, avatars.Alpha],
        )
      ).rows[0].state,
      "available",
    );
    await asUser(playerB);
    await identityAction("avatar", {
      identity_id: identityB,
      avatar_id: avatars.Alpha,
    });

    await adminAvatar(avatars.Beta, "block");
    assert.equal(
      (
        await db.query<{ avatar_id: string }>(
          "select avatar_id from characters where id=$1",
          [characterA],
        )
      ).rows[0].avatar_id,
      avatars.Beta,
    );
    await asUser(playerB);
    await assert.rejects(
      identityAction("avatar", {
        identity_id: identityB,
        avatar_id: avatars.Beta,
      }),
      /Avatar bloqueado/,
    );

    await adminAvatar(avatars.Delta, "exclusive", playerA);
    await asUser(playerB);
    await assert.rejects(
      identityAction("avatar", {
        identity_id: identityB,
        avatar_id: avatars.Delta,
      }),
      /Avatar exclusivo de outro jogador/,
    );
    await asUser(playerA);
    await identityAction("avatar", {
      identity_id: identityA,
      avatar_id: avatars.Delta,
    });

    await adminAvatar(avatars.Epsilon, "share");
    await asUser(playerA);
    await identityAction("avatar", {
      identity_id: identityA,
      avatar_id: avatars.Epsilon,
    });
    await asUser(playerB);
    await identityAction("avatar", {
      identity_id: identityB,
      avatar_id: avatars.Epsilon,
    });
    await asUser(master);
    assert.equal(
      (
        await db.query<{ usage_count: number }>(
          "select usage_count from avatar_catalog($1) where id=$2",
          [campaign, avatars.Epsilon],
        )
      ).rows[0].usage_count,
      2,
    );

    await asUser(playerB);
    await assert.rejects(
      db.query("select admin_avatar_action($1,$2,$3,'unshare',null)", [
        campaign,
        avatars.Epsilon,
        playerB,
      ]),
      /permission denied/,
    );
    await assert.rejects(
      gameAction("avatar", { id: avatars.Beta, active: true }),
      /Somente (Pink|o mestre)/,
    );

    await asUser(master);
    await identityAction("avatar", {
      identity_id: masterIdentity,
      avatar_id: avatars.Epsilon,
    });
    await identityAction("avatar", {
      identity_id: masterIdentity,
      avatar_id: avatars.Beta,
    });
    assert.equal(
      (
        await db.query<{ avatar_id: string }>(
          "select avatar_id from social_identities where id=$1",
          [masterIdentity],
        )
      ).rows[0].avatar_id,
      avatars.Beta,
    );

    await asUser(playerA);
    await gameAction("avatar_select", {
      character_id: characterA,
      avatar_id: avatars.Gamma,
    });
    assert.equal(
      (
        await db.query<{ avatar_id: string }>(
          "select avatar_id from social_identities where id=$1",
          [identityA],
        )
      ).rows[0].avatar_id,
      avatars.Gamma,
    );
    assert.equal(
      (
        await db.query<{ avatar_id: string; image: string }>(
          "select avatar_id,image from characters where id=$1",
          [characterA],
        )
      ).rows[0].image,
      `${campaign}/avatars/gamma.webp`,
    );
  } finally {
    await db.close();
  }
});
