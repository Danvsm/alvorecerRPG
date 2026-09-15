import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { formatDracmas, parseDracmas } from "../lib/currency";

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

test("Brazilian Dracma input is exact in integer cents", () => {
  assert.equal(parseDracmas("25,50"), 2550);
  assert.equal(parseDracmas("1.250,75"), 125075);
  assert.equal(parseDracmas("-10,00", true), -1000);
  assert.equal(formatDracmas(125075), "1.250,75 Dracmas");
  assert.throws(() => parseDracmas("10.5"));
  assert.throws(() => parseDracmas("-1,00"));
});

test("avatar gallery and Dracma transfers enforce permissions and atomic balances", async () => {
  const db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create schema auth;
    create table auth.users(id uuid primary key,email text,encrypted_password text);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
    $$;
    create schema storage;
    create table storage.buckets(
      id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]
    );
    create table storage.objects(name text primary key,bucket_id text);
    alter table storage.objects enable row level security;
    create function storage.foldername(path text) returns text[] language sql immutable as $$
      select string_to_array(regexp_replace(path,'/[^/]+$',''),'/')
    $$;
    create function storage.extension(path text) returns text language sql immutable as $$
      select lower(regexp_replace(path,'^.*\\.','',''))
    $$;
    grant usage on schema public,auth,storage to anon,authenticated,service_role;
    grant execute on function auth.uid() to anon,authenticated,service_role;
    grant select,insert,delete on storage.objects to authenticated,service_role;
    insert into storage.buckets values('portraits','portraits',false,5242880,array['image/jpeg','image/png','image/webp']);
  `);

  for (const file of [
    "001_core.sql",
    "002_accounts.sql",
    "20260911201143_resources_consumables_shops.sql",
    "20260912053818_storage_inventory_indexes.sql",
  ])
    await db.exec(await migration(file));

  const users = (
    await db.query<{ id: string }>(
      "insert into auth.users(id) values(gen_random_uuid()),(gen_random_uuid()),(gen_random_uuid()) returning id",
    )
  ).rows.map((row) => row.id);
  const [master, player, other] = users;
  const campaign = (
    await db.query<{ id: string }>(
      "select bootstrap_campaign($1,'mestre','master@a.invalid','cipher') id",
      [master],
    )
  ).rows[0].id;
  const createPlayer = async (user: string, username: string) =>
    (
      await db.query<{ id: string }>(
        "select provision_player($1,$2,$3,$4,'cipher',$5::jsonb,null) id",
        [
          campaign,
          user,
          username,
          `${username}@a.invalid`,
          JSON.stringify({ name: username, life: 50, money: 100 }),
        ],
      )
    ).rows[0].id;
  const playerCharacter = await createPlayer(player, "arthur");
  const otherCharacter = await createPlayer(other, "bia");

  const asUser = async (user: string) => {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      user,
    ]);
    await db.exec("set role authenticated");
  };
  const action = (op: string, data: object) =>
    db.query("select game_action($1,$2,$3::jsonb)", [
      campaign,
      op,
      JSON.stringify(data),
    ]);

  await db.exec(
    await migration("20260912074700_avatar_gallery_master_account_dracmas.sql"),
  );
  await db.exec(
    await migration("20260912093716_avatar_dracmas_fk_indexes.sql"),
  );
  assert.deepEqual(
    (
      await db.query<{ username: string; display_name: string }>(
        "select username,display_name from profiles where id=$1",
        [master],
      )
    ).rows[0],
    { username: "pink", display_name: "Pink" },
  );
  assert.equal(
    (
      await db.query<{ value: number }>(
        "select dracmas_cents value from characters where id=$1",
        [playerCharacter],
      )
    ).rows[0].value,
    10000,
  );

  await asUser(master);
  const avatarPath = `${campaign}/avatars/teste.webp`;
  await db.query("insert into storage.objects values($1,'portraits')", [
    avatarPath,
  ]);
  await action("avatar", { name: "Sentinela Rubra", storage_path: avatarPath });
  const avatar = (
    await db.query<{ id: string }>(
      "select id from campaign_avatars where storage_path=$1",
      [avatarPath],
    )
  ).rows[0].id;

  await action("avatar_select", {
    character_id: otherCharacter,
    avatar_id: avatar,
  });
  assert.equal(
    (
      await db.query<{ id: string }>(
        "select avatar_id id from characters where id=$1",
        [otherCharacter],
      )
    ).rows[0].id,
    avatar,
  );
  assert.equal(
    (
      await db.query<{ id: string | null }>(
        "select avatar_id id from characters where id=$1",
        [playerCharacter],
      )
    ).rows[0].id,
    null,
  );

  await asUser(player);
  await action("avatar_select", {
    character_id: playerCharacter,
    avatar_id: avatar,
  });
  assert.equal(
    (
      await db.query<{ id: string }>(
        "select avatar_id id from characters where id=$1",
        [playerCharacter],
      )
    ).rows[0].id,
    avatar,
  );
  await assert.rejects(action("avatar", { id: avatar, active: false }));
  await assert.rejects(
    db.query("insert into storage.objects values($1,'portraits')", [
      `${campaign}/avatars/player.webp`,
    ]),
  );

  await action("transfer_dracmas", {
    source_character_id: playerCharacter,
    recipient_type: "player",
    recipient_character_id: otherCharacter,
    amount_cents: 1050,
    reason: "Pagamento da taverna",
    request_id: crypto.randomUUID(),
  });
  await action("transfer_dracmas", {
    source_character_id: playerCharacter,
    recipient_type: "master",
    amount_cents: 500,
    request_id: crypto.randomUUID(),
  });
  await assert.rejects(
    action("transfer_dracmas", {
      source_character_id: playerCharacter,
      recipient_type: "master",
      amount_cents: 0,
      request_id: crypto.randomUUID(),
    }),
  );
  await assert.rejects(
    action("transfer_dracmas", {
      source_character_id: playerCharacter,
      recipient_type: "master",
      amount_cents: 999999,
      request_id: crypto.randomUUID(),
    }),
  );
  await db.exec("reset role");
  assert.equal(
    (
      await db.query<{ value: number }>(
        "select dracmas_cents value from characters where id=$1",
        [playerCharacter],
      )
    ).rows[0].value,
    8450,
  );
  assert.equal(
    (
      await db.query<{ value: number }>(
        "select dracmas_cents value from campaign_members where user_id=$1",
        [master],
      )
    ).rows[0].value,
    500,
  );

  await asUser(master);
  await action("adjust_dracmas", {
    target_type: "master",
    delta_cents: 2000,
    reason: "Caixa inicial",
    request_id: crypto.randomUUID(),
  });
  await action("transfer_dracmas", {
    recipient_type: "player",
    recipient_character_id: playerCharacter,
    amount_cents: 1200,
    reason: "Recompensa",
    request_id: crypto.randomUUID(),
  });
  assert.equal(
    (
      await db.query<{ value: number }>(
        "select dracmas_cents value from campaign_members where user_id=$1",
        [master],
      )
    ).rows[0].value,
    1300,
  );
  assert.equal(
    (await db.query("select * from dracma_transactions")).rows.length,
    4,
  );

  await asUser(other);
  assert.equal(
    (await db.query("select * from dracma_transactions")).rows.length,
    1,
  );
  await assert.rejects(db.query("update characters set dracmas_cents=999999"));
  await db.close();
});
