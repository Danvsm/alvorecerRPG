import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

test("attribute purchases enforce bands, lifetime XP, idempotency and ownership", async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key,email text,encrypted_password text);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      grant usage on schema public,auth to anon,authenticated,service_role;
      create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(name text primary key,bucket_id text); alter table storage.objects enable row level security;
      create function storage.foldername(path text) returns text[] language sql immutable as $$select string_to_array(regexp_replace(path,'/[^/]+$',''),'/')$$;
      create function storage.extension(path text) returns text language sql immutable as $$select split_part(path,'.',2)$$;
      grant usage on schema storage to authenticated; grant select,insert,delete on storage.objects to authenticated;
      insert into storage.buckets values('portraits','portraits',false,262144,array['image/webp']);`);
    for (const file of [
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
      "20260915165506_lock_world_character_media_deletion.sql",
      "20260915155949_avatar_frames_administration.sql",
      "20260915162321_avatar_frames_audit_indexes.sql",
      "20260915171644_enforce_avatar_frame_action_boundaries.sql",
      "20260915173409_allow_force_delete_avatar_frames.sql",
      "20260916040618_expose_equipped_avatar_frames.sql",
      "20260916163449_community_presence.sql",
    ]) {
      const sql = (
        await readFile(
          new URL(`../supabase/migrations/${file}`, import.meta.url),
          "utf8",
        )
      )
        .replace("create extension if not exists pgcrypto;", "")
        .replace(
          "alter publication supabase_realtime add table public.campaign_events;",
          "",
        );
      await db.exec(sql);
    }
    const master = crypto.randomUUID(),
      player = crypto.randomUUID(),
      other = crypto.randomUUID();
    await db.query("insert into auth.users(id) values($1),($2),($3)", [
      master,
      player,
      other,
    ]);
    const campaign = (
      await db.query<{ id: string }>(
        "select bootstrap_campaign($1,'pink','pink@invalid','cipher') id",
        [master],
      )
    ).rows[0].id;
    const ch = (
      await db.query<{ id: string }>(
        "select provision_player($1,$2,'tester','tester@invalid','cipher',$3::jsonb,null,$4) id",
        [
          campaign,
          player,
          JSON.stringify({
            name: "Teste",
            xp: 100000,
            person: { birth_date: "2000-01-01" },
          }),
          master,
        ],
      )
    ).rows[0].id;
    const attrs = (
      await db.query<{ id: string }>(
        "select id from attributes where campaign_id=$1 order by position,id",
        [campaign],
      )
    ).rows.map((a) => a.id);
    const asUser = async (id: string) => {
      await db.exec("reset role");
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
        id,
      ]);
      await db.exec("set role authenticated");
    };
    const progress = async () =>
      (await db.query<{ v: any }>("select character_progression($1) v", [ch]))
        .rows[0].v;
    const buy = async (attribute: string, request = crypto.randomUUID()) =>
      (
        await db.query<{ v: any }>("select buy_attribute($1,$2,$3,$4) v", [
          campaign,
          ch,
          attribute,
          request,
        ])
      ).rows[0].v;
    await asUser(player);
    const activitySession = crypto.randomUUID();
    await db.query("select activity_ping($1,$2,true)", [
      campaign,
      activitySession,
    ]);
    const playerPresence = await db.query<{
      user_id: string;
      online: boolean;
    }>("select * from community_presence($1)", [campaign]);
    assert.equal(
      playerPresence.rows.find((entry) => entry.user_id === player)?.online,
      true,
    );
    assert.equal(
      playerPresence.rows.find((entry) => entry.user_id === master)?.online,
      false,
    );
    await db.query("select activity_ping($1,$2,false)", [
      campaign,
      activitySession,
    ]);
    assert.equal(
      (
        await db.query<{ online: boolean }>(
          "select online from community_presence($1) where user_id=$2",
          [campaign, player],
        )
      ).rows[0].online,
      false,
    );
    await asUser(other);
    await assert.rejects(
      db.query("select * from community_presence($1)", [campaign]),
      /Sem permissão/,
    );
    await asUser(player);
    assert.equal((await progress()).cap, 5);
    for (let n = 0; n < 5; n++) await buy(attrs[0]);
    await assert.rejects(buy(attrs[0]), /meta/);
    for (const a of attrs.slice(1)) for (let n = 0; n < 5; n++) await buy(a);
    const request = crypto.randomUUID();
    const first = await buy(attrs[0], request);
    assert.equal(first.level, 1);
    assert.equal(first.next_unlocked, true);
    assert.equal(first.cap, 10);
    assert.deepEqual(await buy(attrs[0], request), first);
    await assert.rejects(buy(attrs[1], request), /reutilizado/);
    assert.equal((await buy(attrs[1])).level, 2);
    for (let level = 2; level <= 10; level++) {
      for (const a of attrs) {
        const v = (
          await db.query<{ value: number }>(
            "select value from character_attributes where character_id=$1 and attribute_id=$2",
            [ch, a],
          )
        ).rows[0].value;
        for (let n = v; n < level * 5; n++) await buy(a);
      }
      assert.equal((await progress()).level, level);
      if (level < 10) {
        assert.equal((await buy(attrs[0])).level, level);
        assert.equal((await buy(attrs[1])).level, level + 1);
      }
    }
    await assert.rejects(buy(attrs[0]), /meta/);
    assert.equal((await progress()).cap, 50);
    assert.equal((await progress()).xp_total, 100000);
    await asUser(other);
    await assert.rejects(buy(attrs[0]));
    await assert.rejects(progress());
    await asUser(master);
    await db.exec("reset role");
    await db.query("update characters set xp=0,xp_total=0 where id=$1", [ch]);
    assert.equal(
      (
        await db.query<{ xp_total: number }>(
          "select xp_total from characters where id=$1",
          [ch],
        )
      ).rows[0].xp_total,
      100000,
    );
    await db.query(
      "update character_attributes set value=0 where character_id=$1",
      [ch],
    );
    await asUser(player);
    await assert.rejects(buy(attrs[0]), /XP insuficiente/);
    assert.equal((await progress()).xp, 0);
    const identity = (
      await db.query<{ id: string }>(
        "select id from social_identities where user_id=$1",
        [player],
      )
    ).rows[0].id;
    const identityAction = async (op: string, d: object) =>
      (
        await db.query<{ v: any }>(
          "select identity_action($1,$2,$3::jsonb) v",
          [campaign, op, JSON.stringify(d)],
        )
      ).rows[0].v;
    await db.exec("reset role");
    const avatar = (
      await db.query<{ id: string }>(
        "insert into campaign_avatars(campaign_id,name,storage_path,created_by) values($1,'Ladino',$2,$3) returning id",
        [campaign, `${campaign}/avatars/ladino.webp`, master],
      )
    ).rows[0].id;
    await asUser(player);
    await assert.rejects(
      identityAction("cosmetic", { kind: "frame", name: "Proibida" }),
      /Somente Pink/,
    );
    await asUser(master);
    await identityAction("avatar", {
      identity_id: identity,
      avatar_id: avatar,
    });
    assert.equal(
      (
        await db.query<{ avatar_id: string }>(
          "select avatar_id from social_identities where id=$1",
          [identity],
        )
      ).rows[0].avatar_id,
      avatar,
    );
    assert.equal(
      (
        await db.query<{ avatar_id: string }>(
          "select avatar_id from characters where id=$1",
          [ch],
        )
      ).rows[0].avatar_id,
      avatar,
    );
    await assert.rejects(
      identityAction("cosmetic", {
        kind: "frame",
        name: "Rota legada proibida",
      }),
      /frame_action/,
    );
    const cosmetic = await identityAction("cosmetic", {
      kind: "title",
      name: "Primeira sessão",
    });
    await asUser(player);
    await assert.rejects(
      identityAction("equip", {
        identity_id: identity,
        cosmetic_id: cosmetic.id,
      }),
      /bloqueado/,
    );
    await assert.rejects(
      identityAction("grant", {
        identity_id: identity,
        cosmetic_id: cosmetic.id,
      }),
      /Somente Pink/,
    );
    await asUser(master);
    await identityAction("grant", {
      identity_id: identity,
      cosmetic_id: cosmetic.id,
      origin: "session",
    });
    await asUser(player);
    await identityAction("equip", {
      identity_id: identity,
      cosmetic_id: cosmetic.id,
    });
    assert.equal(
      (
        await db.query<{ identity_id: string }>(
          "select * from cosmetic_equipment where identity_id=$1",
          [identity],
        )
      ).rows.length,
      1,
    );
    assert.equal(
      (await db.query("select * from notifications")).rows.length,
      1,
    );
    assert.equal((await db.query("select * from profiles")).rows.length, 1);
    await asUser(master);
    const secondPlayer = crypto.randomUUID();
    await db.exec("reset role");
    await db.query("insert into auth.users(id) values($1)", [secondPlayer]);
    await db.query(
      "select provision_player($1,$2,'tester2','tester2@invalid','cipher',$3::jsonb,null,$4)",
      [
        campaign,
        secondPlayer,
        JSON.stringify({
          name: "Teste 2",
          person: { birth_date: "2000-01-01" },
        }),
        master,
      ],
    );
    const secondIdentity = (
      await db.query<{ id: string }>(
        "select id from social_identities where user_id=$1",
        [secondPlayer],
      )
    ).rows[0].id;
    const frameAction = async (op: string, d: object) =>
      (
        await db.query<{ v: any }>("select frame_action($1,$2,$3::jsonb) v", [
          campaign,
          op,
          JSON.stringify(d),
        ])
      ).rows[0].v;
    const frameCatalog = async () =>
      (await db.query<any>("select * from frame_catalog($1)", [campaign])).rows;
    const framePath = `${campaign}/frames/test.webp`;
    await db.query(
      "insert into storage.objects(name,bucket_id) values($1,'avatar-frames')",
      [framePath],
    );
    await asUser(player);
    await assert.rejects(
      frameAction("save", { name: "Proibida", asset_path: framePath }),
      /Somente Pink/,
    );
    await asUser(master);
    const collection = await frameAction("collection_save", {
      name: "Alvorecer",
    });
    const frame = await frameAction("save", {
      name: "Guardião Violeta",
      description: "Secreta",
      asset_path: framePath,
      rarity: "epic",
      collection_id: collection.id,
      acquisition_origin: "manual",
      secret: true,
      visible: true,
      scale: 1.25,
      offset_x: 4,
      offset_y: -3,
      effects: [
        { type: "glow", color: "#c855ff" },
        { type: "shine", speed: 3 },
      ],
    });
    assert.equal(
      (await frameCatalog()).find((entry: any) => entry.id === frame.id).name,
      "Guardião Violeta",
    );
    await asUser(player);
    assert.equal(
      (
        await db.query<{ value: boolean }>("select is_master($1) value", [
          campaign,
        ])
      ).rows[0].value,
      false,
    );
    assert.equal(
      (
        await db.query("select * from cosmetic_grants where cosmetic_id=$1", [
          frame.id,
        ])
      ).rows.length,
      0,
    );
    const hidden = (await frameCatalog()).find(
      (entry: any) => entry.id === frame.id,
    );
    assert.equal(hidden.owned, false);
    assert.equal(hidden.secret, true);
    assert.equal(hidden.name, "???");
    assert.equal(hidden.asset_path, null);
    assert.deepEqual(hidden.effects, []);
    await assert.rejects(
      frameAction("equip", { identity_id: identity, frame_id: frame.id }),
      /bloqueada/,
    );
    await asUser(master);
    const granted = await frameAction("grant", {
      frame_id: frame.id,
      identity_id: identity,
    });
    assert.equal(granted.added, 1);
    assert.equal(
      (
        await db.query(
          "select * from cosmetic_grants where cosmetic_id=$1 and removed_at is null",
          [frame.id],
        )
      ).rows.length,
      1,
    );
    await assert.rejects(
      frameAction("grant", { frame_id: frame.id, identity_id: identity }),
      /já possui/,
    );
    await db.exec("reset role");
    assert.equal(
      (
        await db.query("select * from notifications where reference_id=$1", [
          frame.id,
        ])
      ).rows.length,
      1,
    );
    await asUser(player);
    assert.equal(
      (await frameCatalog()).find((entry: any) => entry.id === frame.id).name,
      "Guardião Violeta",
    );
    await frameAction("equip", { identity_id: identity, frame_id: frame.id });
    assert.equal(
      (
        await db.query(
          "select * from cosmetic_equipment where identity_id=$1 and cosmetic_id=$2",
          [identity, frame.id],
        )
      ).rows.length,
      1,
    );
    await asUser(secondPlayer);
    const publiclyEquipped = (await frameCatalog()).find(
      (entry: any) => entry.id === frame.id,
    );
    assert.equal(publiclyEquipped.owned, false);
    assert.equal(publiclyEquipped.name, "???");
    assert.equal(publiclyEquipped.asset_path, framePath);
    assert.equal(publiclyEquipped.effects.length, 2);
    assert.equal(
      (
        await db.query(
          "select 1 from storage.objects where bucket_id='avatar-frames' and name=$1",
          [framePath],
        )
      ).rows.length,
      1,
    );
    await asUser(master);
    await frameAction("revoke", { identity_id: identity, frame_id: frame.id });
    assert.equal(
      (
        await db.query(
          "select * from cosmetic_equipment where identity_id=$1 and kind='frame'",
          [identity],
        )
      ).rows.length,
      0,
    );
    assert.equal(
      (
        await db.query<{ removed_at: string; removed_by: string }>(
          "select removed_at,removed_by from cosmetic_grants where identity_id=$1 and cosmetic_id=$2",
          [identity, frame.id],
        )
      ).rows[0].removed_by,
      master,
    );
    await asUser(player);
    await assert.rejects(
      identityAction("equip", {
        identity_id: identity,
        cosmetic_id: frame.id,
      }),
      /frame_action/,
    );
    await asUser(master);
    await assert.rejects(
      identityAction("grant", {
        identity_id: identity,
        cosmetic_id: frame.id,
      }),
      /frame_action/,
    );
    await frameAction("archive", { frame_id: frame.id });
    assert.equal(
      (
        await db.query<{ active: boolean; archived_at: string }>(
          "select active,archived_at from cosmetics where id=$1",
          [frame.id],
        )
      ).rows[0].active,
      false,
    );
    await frameAction("reactivate", { frame_id: frame.id });
    const configuredFrame = (
      await db.query<any>(
        "select scale,offset_x,offset_y,effects from cosmetics where id=$1",
        [frame.id],
      )
    ).rows[0];
    assert.equal(Number(configuredFrame.scale), 1.25);
    assert.equal(Number(configuredFrame.offset_x), 4);
    assert.equal(configuredFrame.effects.length, 2);
    const social = async (op: string, d: object) =>
      (
        await db.query<{ v: any }>("select social_action($1,$2,$3::jsonb) v", [
          campaign,
          op,
          JSON.stringify(d),
        ])
      ).rows[0].v;
    await asUser(master);
    const npc = await identityAction("npc", { name: "Rukia" });
    await identityAction("grant", {
      identity_id: npc.id,
      cosmetic_id: cosmetic.id,
      origin: "event",
    });
    await identityAction("equip", {
      identity_id: npc.id,
      cosmetic_id: cosmetic.id,
    });
    const rewardRequest = crypto.randomUUID();
    const reward = async (d: object, id = rewardRequest) =>
      (
        await db.query<{ v: any }>(
          "select grant_reward($1,$2,$3::jsonb,$4) v",
          [campaign, ch, JSON.stringify(d), id],
        )
      ).rows[0].v;
    const rewardData = {
      xp: 100,
      cents: 50,
      reason: "Teste de recompensa",
      cosmetics: [cosmetic.id],
    };
    assert.equal((await reward(rewardData)).xp_after, 100);
    await reward(rewardData);
    assert.equal((await progress()).xp, 100);
    assert.equal(
      (await db.query("select * from dracma_transactions where kind='reward'"))
        .rows.length,
      1,
    );
    await assert.rejects(
      reward(
        { ...rewardData, cosmetics: [crypto.randomUUID()] },
        crypto.randomUUID(),
      ),
      /indisponível/,
    );
    assert.equal((await progress()).xp, 100);
    const beforeFrameReward = (
      await db.query<{ xp: number; dracmas_cents: number }>(
        "select xp,dracmas_cents from characters where id=$1",
        [ch],
      )
    ).rows[0];
    const frameRewardRequest = crypto.randomUUID();
    await assert.rejects(
      reward({ xp: 10, cents: 25, cosmetics: [frame.id] }, frameRewardRequest),
      /frame_action/,
    );
    assert.deepEqual(
      (
        await db.query<{ xp: number; dracmas_cents: number }>(
          "select xp,dracmas_cents from characters where id=$1",
          [ch],
        )
      ).rows[0],
      beforeFrameReward,
    );
    assert.equal(
      (
        await db.query(
          "select 1 from cosmetic_grants where identity_id=$1 and cosmetic_id=$2 and removed_at is null",
          [identity, frame.id],
        )
      ).rows.length,
      0,
    );
    const deleteAvatarFrame = async (frameId: string) =>
      (
        await db.query<{ v: any }>("select delete_avatar_frame($1,$2) v", [
          campaign,
          frameId,
        ])
      ).rows[0].v;
    await asUser(player);
    await assert.rejects(deleteAvatarFrame(frame.id), /Somente Pink/);
    await asUser(master);
    await frameAction("grant", {
      frame_id: frame.id,
      identity_ids: [identity, secondIdentity],
    });
    await frameAction("equip", {
      frame_id: frame.id,
      identity_id: identity,
    });
    await frameAction("equip", {
      frame_id: frame.id,
      identity_id: secondIdentity,
    });
    const identityAvatarBeforeDelete = (
      await db.query<{ avatar_id: string }>(
        "select avatar_id from social_identities where id=$1",
        [identity],
      )
    ).rows[0].avatar_id;
    const deletedFrame = await deleteAvatarFrame(frame.id);
    assert.equal(deletedFrame.asset_path, framePath);
    assert.equal(deletedFrame.owners_removed, 2);
    assert.equal(deletedFrame.equipment_removed, 2);
    assert.equal(
      (await db.query("select 1 from cosmetics where id=$1", [frame.id])).rows
        .length,
      0,
    );
    assert.equal(
      (
        await db.query("select 1 from cosmetic_grants where cosmetic_id=$1", [
          frame.id,
        ])
      ).rows.length,
      0,
    );
    assert.equal(
      (
        await db.query(
          "select 1 from cosmetic_equipment where cosmetic_id=$1",
          [frame.id],
        )
      ).rows.length,
      0,
    );
    assert.equal(
      (
        await db.query(
          "select 1 from notifications where campaign_id=$1 and kind='cosmetic' and reference_id=$2",
          [campaign, frame.id],
        )
      ).rows.length,
      0,
    );
    assert.equal(
      (
        await db.query(
          "select 1 from cosmetic_equipment where identity_id=$1 and cosmetic_id=$2",
          [identity, cosmetic.id],
        )
      ).rows.length,
      1,
    );
    assert.equal(
      (await db.query("select 1 from profiles where id=$1", [player])).rows
        .length,
      1,
    );
    assert.equal(
      (
        await db.query(
          "select 1 from cosmetic_grants where identity_id=$1 and cosmetic_id=$2",
          [identity, cosmetic.id],
        )
      ).rows.length,
      1,
    );
    assert.equal(
      (
        await db.query<{ avatar_id: string }>(
          "select avatar_id from social_identities where id=$1",
          [identity],
        )
      ).rows[0].avatar_id,
      identityAvatarBeforeDelete,
    );
    assert.equal(
      (
        await db.query(
          "select 1 from characters where id=$1 and not archived",
          [ch],
        )
      ).rows.length,
      1,
    );
    assert.equal(
      (
        await db.query(
          "select 1 from audit_logs where campaign_id=$1 and action='frame_delete' and detail->>'id'=$2",
          [campaign, frame.id],
        )
      ).rows.length,
      1,
    );
    const sharedFramePath = `${campaign}/frames/shared.webp`;
    await db.exec("reset role");
    await db.query(
      "insert into storage.objects(name,bucket_id) values($1,'avatar-frames')",
      [sharedFramePath],
    );
    await asUser(master);
    const sharedFrame = await frameAction("save", {
      name: "Moldura compartilhada",
      asset_path: sharedFramePath,
    });
    const sharedCopy = await frameAction("duplicate", {
      frame_id: sharedFrame.id,
    });
    assert.equal((await deleteAvatarFrame(sharedFrame.id)).asset_path, null);
    assert.equal(
      (
        await db.query<{ asset_path: string }>(
          "select asset_path from cosmetics where id=$1",
          [sharedCopy.id],
        )
      ).rows[0].asset_path,
      sharedFramePath,
    );
    assert.equal(
      (await deleteAvatarFrame(sharedCopy.id)).asset_path,
      sharedFramePath,
    );
    const personal = {
      full_name: "Jogador Exemplo",
      email: "exemplo@example.test",
      birth_date: "2001-02-03",
      username: "tester_novo",
    };
    await db.query("select admin_player_data($1,$2,$3::jsonb)", [
      campaign,
      player,
      JSON.stringify(personal),
    ]);
    await assert.rejects(
      db.query("select admin_player_data($1,$2,$3::jsonb)", [
        campaign,
        player,
        JSON.stringify({ ...personal, birth_date: "" }),
      ]),
      /obrigatória/,
    );
    await asUser(player);
    await assert.rejects(
      reward(rewardData, crypto.randomUUID()),
      /Somente Pink/,
    );
    await assert.rejects(
      db.query("select admin_player_summary($1,$2)", [campaign, player]),
      /Somente Pink/,
    );
    await assert.rejects(
      social("comment", {
        actor_id: npc.id,
        recipient_id: identity,
        body: "Falsa",
      }),
      /não autorizada/,
    );
    const conversation = await social("conversation", {
      actor_id: identity,
      recipient_id: npc.id,
    });
    await social("message", {
      actor_id: identity,
      conversation_id: conversation.id,
      body: "Olá Rukia",
    });
    const mediaAction = async (op: string, d: object) =>
      (
        await db.query<{ v: any }>(
          "select chat_media_action($1,$2,$3::jsonb) v",
          [campaign, op, JSON.stringify(d)],
        )
      ).rows[0].v;
    const upload = await mediaAction("reserve", {
      actor_id: identity,
      conversation_id: conversation.id,
    });
    await assert.rejects(
      mediaAction("send", { actor_id: identity, media_id: upload.id }),
      /incompleto/,
    );
    await db.query(
      "insert into storage.objects(name,bucket_id) values($1,'chat-media')",
      [upload.path],
    );
    await mediaAction("send", { actor_id: identity, media_id: upload.id });
    await mediaAction("send", { actor_id: identity, media_id: upload.id });
    await asUser(master);
    await social("message", {
      actor_id: npc.id,
      conversation_id: conversation.id,
      body: "Olá aventureiro",
    });
    await social("comment", {
      actor_id: npc.id,
      recipient_id: identity,
      body: "Bem-vindo",
    });
    await asUser(player);
    assert.equal(
      (await db.query("select * from direct_messages")).rows.length,
      3,
    );
    assert.equal(
      (await db.query("select * from profile_comments")).rows.length,
      1,
    );
    await assert.rejects(
      db.query("select prepare_delete_world_character($1,$2,$3)", [
        campaign,
        npc.id,
        player,
      ]),
      /permission denied/,
    );
    await db.exec("reset role; set role service_role");
    const prepareWorldCharacterDeletion = async (
      targetId: string,
      actor: string,
    ) =>
      (
        await db.query<{ v: any }>(
          "select prepare_delete_world_character($1,$2,$3) v",
          [campaign, targetId, actor],
        )
      ).rows[0].v;
    const finalizeWorldCharacterDeletion = async (
      targetId: string,
      actor: string,
      removedPaths: string[] = [],
    ) =>
      (
        await db.query<{ v: any }>(
          "select finalize_delete_world_character($1,$2,$3,$4) v",
          [campaign, targetId, actor, removedPaths],
        )
      ).rows[0].v;
    await assert.rejects(
      prepareWorldCharacterDeletion(npc.id, player),
      /Somente Pink/,
    );
    await assert.rejects(
      finalizeWorldCharacterDeletion(identity, master),
      /Personagem do mundo inválido/,
    );
    assert.equal(
      (await db.query("select id from characters where id=$1", [ch])).rows
        .length,
      1,
    );
    assert.equal(
      (
        await db.query("select id from social_identities where id=$1", [
          identity,
        ])
      ).rows.length,
      1,
    );
    const preparedDeletion = await prepareWorldCharacterDeletion(
      npc.id,
      master,
    );
    assert.deepEqual(preparedDeletion.storage_paths, [upload.path]);
    await db.exec("reset role");
    await db.query(
      "delete from storage.objects where name=$1 and bucket_id='chat-media'",
      [upload.path],
    );
    const racingPath = `${conversation.id}/racing.webp`;
    await db.query(
      "insert into storage.objects(name,bucket_id) values($1,'chat-media')",
      [racingPath],
    );
    await db.query(
      "insert into chat_media(conversation_id,sender_id,uploader_id,storage_path,consumed) values($1,$2,$3,$4,true)",
      [conversation.id, identity, player, racingPath],
    );
    await db.exec("set role service_role");
    const racedDeletion = await finalizeWorldCharacterDeletion(npc.id, master, [
      upload.path,
    ]);
    assert.equal(racedDeletion.deleted, false);
    assert.deepEqual(
      racedDeletion.storage_paths.sort(),
      [upload.path, racingPath].sort(),
    );
    assert.equal(
      (await db.query("select id from social_identities where id=$1", [npc.id]))
        .rows.length,
      1,
    );
    await db.exec("reset role");
    await db.query(
      "delete from storage.objects where name=$1 and bucket_id='chat-media'",
      [racingPath],
    );
    await db.exec("set role service_role");
    assert.deepEqual(
      await finalizeWorldCharacterDeletion(npc.id, master, [
        upload.path,
        racingPath,
      ]),
      {
        id: npc.id,
        deleted: true,
      },
    );
    assert.equal(
      (await db.query("select id from social_identities where id=$1", [npc.id]))
        .rows.length,
      0,
    );
    assert.equal(
      (
        await db.query("select * from direct_conversations where id=$1", [
          conversation.id,
        ])
      ).rows.length,
      0,
    );
    assert.equal(
      (
        await db.query(
          "select * from direct_messages where conversation_id=$1",
          [conversation.id],
        )
      ).rows.length,
      0,
    );
    assert.equal(
      (
        await db.query("select * from chat_media where conversation_id=$1", [
          conversation.id,
        ])
      ).rows.length,
      0,
    );
    await db.exec("reset role");
    assert.equal(
      (
        await db.query("select * from storage.objects where name=$1", [
          upload.path,
        ])
      ).rows.length,
      0,
    );
    assert.equal(
      (
        await db.query(
          "select * from profile_comments where author_id=$1 or profile_id=$1",
          [npc.id],
        )
      ).rows.length,
      0,
    );
    assert.equal(
      (
        await db.query("select * from cosmetic_grants where identity_id=$1", [
          npc.id,
        ])
      ).rows.length,
      0,
    );
    assert.equal(
      (
        await db.query(
          "select * from cosmetic_equipment where identity_id=$1",
          [npc.id],
        )
      ).rows.length,
      0,
    );
    assert.equal(
      (await db.query("select id from characters where id=$1", [ch])).rows
        .length,
      1,
    );
    assert.equal(
      (
        await db.query("select id from social_identities where id=$1", [
          identity,
        ])
      ).rows.length,
      1,
    );
    await asUser(other);
    assert.equal(
      (await db.query("select * from social_identities")).rows.length,
      0,
    );
    assert.equal(
      (await db.query("select * from notifications")).rows.length,
      0,
    );
    assert.equal(
      (await db.query("select * from direct_messages")).rows.length,
      0,
    );
    await assert.rejects(
      social("message", {
        actor_id: identity,
        conversation_id: conversation.id,
        body: "Invasão",
      }),
      /Sem permissão/,
    );
  } finally {
    await db.close();
  }
});
