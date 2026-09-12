import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const sql = async (name: string) =>
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

test("profile privacy, progression, wallet, activity and lifecycle remain server-enforced", async () => {
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
    insert into storage.buckets values(
      'portraits','portraits',false,5242880,array['image/jpeg','image/png','image/webp']
    );
  `);
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
  ])
    await db.exec(await sql(file));

  const users = (
    await db.query<{ id: string }>(
      "insert into auth.users(id) values(gen_random_uuid()),(gen_random_uuid()),(gen_random_uuid()) returning id",
    )
  ).rows.map((row) => row.id);
  const [master, luna, kael] = users;
  const campaign = (
    await db.query<{ id: string }>(
      "select bootstrap_campaign($1,'pink','master@invalid','cipher') id",
      [master],
    )
  ).rows[0].id;
  const createPlayer = async (user: string, username: string, name: string) =>
    (
      await db.query<{ id: string }>(
        "select provision_player($1,$2,$3,$4,'cipher',$5::jsonb,null,$6) id",
        [
          campaign,
          user,
          username,
          `${username}@invalid`,
          JSON.stringify({
            name,
            xp: 100,
            dracmas_cents: 10000,
            person: {
              full_name: `${name} da Silva`,
              email: `${username}@example.com`,
              birth_date: "2001-08-14",
            },
          }),
          master,
        ],
      )
    ).rows[0].id;
  const lunaCharacter = await createPlayer(luna, "luna", "Luna");
  const kaelCharacter = await createPlayer(kael, "kael", "Kael");

  const asUser = async (user: string) => {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      user,
    ]);
    await db.exec("set role authenticated");
  };
  const wallet = (op: string, data: object) =>
    db.query<{ value: any }>("select wallet_action($1,$2,$3::jsonb) value", [
      campaign,
      op,
      JSON.stringify(data),
    ]);
  const action = (op: string, data: object) =>
    db.query("select game_action($1,$2,$3::jsonb)", [
      campaign,
      op,
      JSON.stringify(data),
    ]);
  const lifecycle = (op: string, data: object) =>
    db.query("select lifecycle_action($1,$2,$3::jsonb)", [
      campaign,
      op,
      JSON.stringify(data),
    ]);

  await asUser(luna);
  const ownProfile = (
    await db.query<{ full_name: string; personal_email: string }>(
      "select full_name,personal_email from profiles",
    )
  ).rows[0];
  assert.deepEqual(ownProfile, {
    full_name: "Luna da Silva",
    personal_email: "luna@example.com",
  });
  assert.equal(
    (await db.query("select * from profiles where id=$1", [kael])).rows.length,
    0,
  );
  assert.equal(
    (
      await db.query<{ xp: number; xp_total: number }>(
        "select xp,xp_total from characters where id=$1",
        [lunaCharacter],
      )
    ).rows[0].xp_total,
    100,
  );

  await action("transfer_dracmas", {
    source_character_id: lunaCharacter,
    recipient_type: "player",
    recipient_character_id: kaelCharacter,
    amount_cents: 1250,
    reason: "Poção",
    request_id: crypto.randomUUID(),
  });
  const charge = (
    await wallet("create_charge", {
      source_character_id: lunaCharacter,
      recipient_type: "player",
      recipient_character_id: kaelCharacter,
      amount_cents: 3500,
      reason: "Metade da poção",
    })
  ).rows[0].value;

  await asUser(kael);
  const payRequest = crypto.randomUUID();
  const receipt = (
    await wallet("pay_charge", { charge_id: charge.id, request_id: payRequest })
  ).rows[0].value;
  const retry = (
    await wallet("pay_charge", { charge_id: charge.id, request_id: payRequest })
  ).rows[0].value;
  assert.equal(retry.id, receipt.id);
  assert.equal(
    (
      await db.query<{ n: number }>(
        "select count(*)::int n from dracma_transactions where kind='charge_payment'",
      )
    ).rows[0].n,
    1,
  );
  await assert.rejects(
    wallet("distribute_reward", {
      character_ids: [kaelCharacter],
      amount_cents: 100,
      mode: "each",
      request_id: crypto.randomUUID(),
    }),
  );

  await asUser(master);
  await wallet("distribute_reward", {
    character_ids: [lunaCharacter, kaelCharacter],
    amount_cents: 1001,
    mode: "split",
    reason: "Missão",
    request_id: crypto.randomUUID(),
  });
  await wallet("reverse_transaction", {
    transaction_id: receipt.id,
    reason: "Pagamento duplicado",
    request_id: crypto.randomUUID(),
  });
  assert.equal(
    (
      await db.query<{ n: number }>(
        "select count(*)::int n from dracma_transactions where kind='reversal'",
      )
    ).rows[0].n,
    1,
  );

  await db.query("select game_command($1,'balance',$2::jsonb)", [
    campaign,
    JSON.stringify({
      character_id: lunaCharacter,
      key: "xp",
      delta: 50,
      reason: "Missão",
    }),
  ]);
  await db.query("select game_command($1,'balance',$2::jsonb)", [
    campaign,
    JSON.stringify({
      character_id: lunaCharacter,
      key: "xp",
      delta: -25,
      reason: "Evolução",
    }),
  ]);
  assert.deepEqual(
    (
      await db.query<{ xp: number; xp_total: number }>(
        "select xp,xp_total from characters where id=$1",
        [lunaCharacter],
      )
    ).rows[0],
    { xp: 125, xp_total: 150 },
  );

  await db.query("select game_command($1,'creature',$2::jsonb)", [
    campaign,
    JSON.stringify({ name: "Goblin", life: 20 }),
  ]);
  await db.query("select game_command($1,'room',$2::jsonb)", [
    campaign,
    JSON.stringify({ name: "Ruínas" }),
  ]);
  const creature = (
    await db.query<{ id: string }>(
      "select id from creature_templates where name='Goblin' limit 1",
    )
  ).rows[0].id;
  const room = (
    await db.query<{ id: string }>(
      "select id from combat_rooms where name='Ruínas' limit 1",
    )
  ).rows[0].id;
  await db.query("select game_command($1,'participant',$2::jsonb)", [
    campaign,
    JSON.stringify({ room_id: room, template_id: creature, name: "Goblin 1" }),
  ]);
  await assert.rejects(
    lifecycle("delete", { entity: "creature", id: creature }),
  );
  await db.query("select game_command($1,'room',$2::jsonb)", [
    campaign,
    JSON.stringify({ id: room, active: false }),
  ]);
  await lifecycle("delete", { entity: "creature", id: creature });
  assert.equal(
    (
      await db.query("select * from combat_participants where room_id=$1", [
        room,
      ])
    ).rows.length,
    1,
  );

  await lifecycle("archive", { entity: "character", id: kaelCharacter });
  const cleanup = (
    await db.query<{ value: any }>("select cleanup_preview($1) value", [
      campaign,
    ])
  ).rows[0].value;
  assert.equal(cleanup.characters[0].name, "Kael");
  assert.equal(cleanup.characters[0].entity, "character");

  await asUser(luna);
  const activityId = crypto.randomUUID();
  await db.query("select activity_ping($1,$2,true)", [campaign, activityId]);
  await db.query("select submit_session_feedback($1,5,'Funcionou bem')", [
    campaign,
  ]);
  await assert.rejects(
    lifecycle("delete", { entity: "character", id: kaelCharacter }),
  );
  await db.exec("reset role");
  await db.query(
    "update campaign_members set access_active=false where campaign_id=$1 and user_id=$2",
    [campaign, luna],
  );
  await asUser(luna);
  assert.equal(
    (
      await db.query<{ value: boolean }>("select is_member($1) value", [
        campaign,
      ])
    ).rows[0].value,
    false,
  );
  await assert.rejects(
    wallet("create_charge", {
      source_character_id: lunaCharacter,
      recipient_type: "master",
      amount_cents: 100,
    }),
  );
  await db.exec("reset role");
  await db.query("delete from auth.users where id=$1", [kael]);
  await db.query("delete from characters where id=$1", [kaelCharacter]);
  const preservedCharge = (
    await db.query<{ requester_label: string; target_label: string }>(
      "select requester_label,target_label from dracma_charges limit 1",
    )
  ).rows[0];
  assert.deepEqual(preservedCharge, {
    requester_label: "Luna",
    target_label: "Kael",
  });
  await db.close();
});
