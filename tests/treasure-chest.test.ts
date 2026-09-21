import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migration = () =>
  readFile(
    new URL(
      "../supabase/migrations/20260920172133_treasure_chest.sql",
      import.meta.url,
    ),
    "utf8",
  );
const pendingRewardsMigration = () =>
  readFile(
    new URL(
      "../supabase/migrations/20260920233417_chest_pending_rewards.sql",
      import.meta.url,
    ),
    "utf8",
  );
const rewardDeleteMigration = () =>
  readFile(
    new URL(
      "../supabase/migrations/20260920234823_chest_reward_delete.sql",
      import.meta.url,
    ),
    "utf8",
  );

test("chest rarity configuration totals exactly 100 percent", async () => {
  const sql = await migration();
  const seed = [
    ...sql.matchAll(/\('(?:common|uncommon|rare|epic|legendary)',(\d+)\)/g),
  ]
    .slice(0, 5)
    .map((match) => Number(match[1]));
  assert.deepEqual(seed, [5200, 2700, 1400, 500, 200]);
  assert.equal(
    seed.reduce((sum, value) => sum + value, 0),
    10_000,
  );
  assert.match(sql, /odds_total<>10000/);
});

test("chest protects currency, identity and duplicate cosmetics in database functions", async () => {
  const sql = await migration();
  assert.match(sql, /for update;/i);
  assert.match(
    sql,
    /if member\.gems<price then raise exception 'Gemas insuficientes'/,
  );
  assert.match(sql, /unique \(user_id, request_id\)/);
  assert.match(sql, /unique \(sender_user_id, request_id\)/);
  assert.match(sql, /not exists\(select 1 from public\.avatar_grants/);
  assert.match(sql, /not exists\(select 1 from public\.cosmetic_grants/);
});

test("supporter, event and master frames cannot enter the chest catalog", async () => {
  const sql = await migration();
  const allowed = "('common','uncommon','rare','epic','legendary')";
  assert.ok(sql.includes(`x.rarity in ${allowed}`));
  assert.doesNotMatch(
    sql.match(/'frames',\(select[\s\S]*?\)\n  \);/)?.[0] || "",
    /supporter|event|master/,
  );
});

test("player chest includes gift, next-opening loop, odds and reduced-motion support", async () => {
  const [component, admin, cosmetics, css, game] = await Promise.all([
    readFile(
      new URL("../components/TreasureChest.tsx", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../components/ChestAdmin.tsx", import.meta.url), "utf8"),
    readFile(
      new URL("../components/CosmeticsPanel.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../components/TreasureChest.module.css", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../components/Game.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(component, /Abrir outro por/);
  assert.match(component, /Presentear um Baú/);
  assert.match(component, /Chances por raridade/);
  assert.match(component, /\/treasure\/gems\.webp/);
  assert.match(component, /Prêmio extraordinário/);
  assert.match(component, /cosmeticResult/);
  assert.match(component, /crypto\.randomUUID\(\)/);
  assert.match(component, /await onChanged\?\.\(\)/);
  assert.match(admin, /option value="xp"/);
  assert.match(admin, /option value="dracmas"/);
  assert.match(admin, /reward_delete/);
  assert.match(admin, /chance base/);
  assert.match(admin, /rewardRarity/);
  assert.match(cosmetics, /frames\.filter\(\(frame\) => frame\.owned\)/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(game, /\["Baú", Gem\]/);
  assert.match(game, /<ChestAdmin campaign=\{campaign\}/);
});

test("official Gem asset is optimized for the interface", async () => {
  const asset = await stat(
    new URL("../public/treasure/gems.webp", import.meta.url),
  );
  assert.ok(asset.size > 1_000);
  assert.ok(asset.size < 80_000);
});

test("only Pink can permanently remove a configured chest reward", async () => {
  const sql = await rewardDeleteMigration();
  assert.match(sql, /if not public\.is_master\(c\)/);
  assert.match(sql, /op='reward_delete'/);
  assert.match(sql, /delete from public\.chest_rewards/);
  assert.match(sql, /set chest_only=false/);
});

test("chest opening and gifting debit once and deliver rewards atomically", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create schema alvorecer_private;
      create function auth.uid() returns uuid language sql stable as
        $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      create table profiles(id uuid primary key,username text not null,display_name text not null default '');
      create table campaigns(id uuid primary key);
      create table campaign_members(campaign_id uuid references campaigns,user_id uuid references profiles,role text not null,
        access_active boolean not null default true,archived_at timestamptz,dracmas_cents bigint not null default 0,primary key(campaign_id,user_id));
      create function public.is_member(c uuid) returns boolean language sql stable security definer set search_path=public as
        $$select exists(select 1 from campaign_members where campaign_id=c and user_id=auth.uid())$$;
      create function public.is_master(c uuid) returns boolean language sql stable security definer set search_path=public as
        $$select exists(select 1 from campaign_members where campaign_id=c and user_id=auth.uid() and role='master')$$;
      create table campaign_avatars(id uuid primary key,campaign_id uuid references campaigns,name text not null,storage_path text not null,
        active boolean not null default true,blocked boolean not null default false,shared boolean not null default false,exclusive_user_id uuid references profiles,
        created_by uuid references profiles,created_at timestamptz default now(),archived_at timestamptz);
      create table social_identities(id uuid primary key,campaign_id uuid references campaigns,user_id uuid references profiles,kind text,name text,
        avatar_id uuid references campaign_avatars,active boolean not null default true,unique(campaign_id,user_id));
      create table cosmetics(id uuid primary key,campaign_id uuid references campaigns,kind text,name text,description text default '',color text default '#ffffff',icon text default 'star',active boolean default true,
        rarity text default 'common',acquisition_origin text default 'manual',asset_path text,archived_at timestamptz,created_at timestamptz default now());
      create table cosmetic_grants(identity_id uuid references social_identities,cosmetic_id uuid references cosmetics,origin text,note text default '',created_at timestamptz default now(),granted_by uuid references profiles,removed_at timestamptz,removed_by uuid references profiles,primary key(identity_id,cosmetic_id));
      create table characters(id uuid primary key,campaign_id uuid references campaigns,owner_id uuid references profiles,name text,xp integer default 0,
        money integer default 0,dracmas_cents bigint default 0,archived boolean default false,avatar_id uuid references campaign_avatars);
      create table dracma_transactions(id uuid primary key default gen_random_uuid(),campaign_id uuid references campaigns,kind text,actor_id uuid references profiles,
        to_user_id uuid references profiles,to_character_id uuid references characters,to_label text,amount_cents bigint,reason text,to_balance_after bigint);
      create table notifications(id bigint generated always as identity primary key,campaign_id uuid references campaigns,user_id uuid references profiles,
        kind text,title text,body text,reference_id text,created_at timestamptz default now());
      grant usage on schema public,auth to authenticated,service_role;
      grant execute on function auth.uid() to authenticated,service_role;
      grant select on campaign_members,characters to authenticated;
    `);
    await db.exec(await migration());
    await db.exec(await pendingRewardsMigration());
    await db.exec(await rewardDeleteMigration());
    const ids = [
      crypto.randomUUID(),
      crypto.randomUUID(),
      crypto.randomUUID(),
      crypto.randomUUID(),
    ];
    const [campaign, master, player, other] = ids;
    await db.query(
      "insert into profiles(id,username) values($1,'pink'),($2,'hero'),($3,'friend')",
      [master, player, other],
    );
    await db.query("insert into campaigns(id) values($1)", [campaign]);
    await db.query(
      "insert into campaign_members(campaign_id,user_id,role) values($1,$2,'master'),($1,$3,'player'),($1,$4,'player')",
      [campaign, master, player, other],
    );
    const playerIdentity = crypto.randomUUID(),
      otherIdentity = crypto.randomUUID(),
      playerCharacter = crypto.randomUUID(),
      otherCharacter = crypto.randomUUID();
    await db.query(
      "insert into social_identities(id,campaign_id,user_id,kind,name) values($1,$2,$3,'player','Hero'),($4,$2,$5,'player','Friend')",
      [playerIdentity, campaign, player, otherIdentity, other],
    );
    await db.query(
      "insert into characters(id,campaign_id,owner_id,name) values($1,$2,$3,'Hero'),($4,$2,$5,'Friend')",
      [playerCharacter, campaign, player, otherCharacter, other],
    );
    await db.query(
      "update chest_rewards set active=false where campaign_id=$1",
      [campaign],
    );
    await db.query(
      "insert into chest_rewards(campaign_id,rarity,reward_type,label,amount,weight) values($1,'common','xp','10 XP',10,1)",
      [campaign],
    );
    await db.query(
      "update chest_rarity_odds set weight_bp=case when rarity='common' then 10000 else 0 end where campaign_id=$1",
      [campaign],
    );
    const asUser = async (id: string) => {
      await db.exec("reset role");
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
        id,
      ]);
      await db.exec("set role authenticated");
    };
    await asUser(master);
    await db.query("select chest_admin_action($1,'adjust_gems',$2::jsonb)", [
      campaign,
      JSON.stringify({ user_id: player, delta: 60 }),
    ]);
    await asUser(player);
    const opened = (
      await db.query<{ value: any }>("select chest_open($1,$2,null,$3) value", [
        campaign,
        playerCharacter,
        crypto.randomUUID(),
      ])
    ).rows[0].value;
    assert.equal(opened.reward_label, "10 XP");
    assert.equal(opened.gems, 30);
    const giftId = (
      await db.query<{ value: any }>(
        "select chest_gift($1,$2,'Boa sorte!',$3) value",
        [campaign, other, crypto.randomUUID()],
      )
    ).rows[0].value.gift_id;
    assert.equal(
      (
        await db.query<{ gems: number }>(
          "select gems from campaign_members where campaign_id=$1 and user_id=$2",
          [campaign, player],
        )
      ).rows[0].gems,
      0,
    );
    await asUser(other);
    const gifted = (
      await db.query<{ value: any }>("select chest_open($1,$2,$3,$4) value", [
        campaign,
        otherCharacter,
        giftId,
        crypto.randomUUID(),
      ])
    ).rows[0].value;
    assert.equal(gifted.cost_gems, 0);
    assert.equal(gifted.reward_label, "10 XP");
    assert.equal(
      (
        await db.query<{ xp: number }>(
          "select xp from characters where id=$1",
          [otherCharacter],
        )
      ).rows[0].xp,
      10,
    );

    const waiting = crypto.randomUUID();
    const waitingIdentity = crypto.randomUUID();
    await db.exec("reset role");
    await db.query("insert into profiles(id,username) values($1,'waiting')", [
      waiting,
    ]);
    await db.query(
      "insert into campaign_members(campaign_id,user_id,role) values($1,$2,'player')",
      [campaign, waiting],
    );
    await db.query(
      "insert into social_identities(id,campaign_id,user_id,kind,name) values($1,$2,$3,'player','Waiting')",
      [waitingIdentity, campaign, waiting],
    );
    await asUser(master);
    await db.query("select chest_admin_action($1,'adjust_gems',$2::jsonb)", [
      campaign,
      JSON.stringify({ user_id: waiting, delta: 30 }),
    ]);
    await asUser(waiting);
    const pending = (
      await db.query<{ value: any }>(
        "select chest_open($1,null,null,$2) value",
        [campaign, crypto.randomUUID()],
      )
    ).rows[0].value;
    assert.equal(pending.pending, true);
    const dashboard = (
      await db.query<{ value: any }>("select chest_dashboard($1) value", [
        campaign,
      ])
    ).rows[0].value;
    assert.equal(dashboard.pending_xp, 10);
    await db.exec("reset role");
    const waitingCharacter = crypto.randomUUID();
    await db.query(
      "insert into characters(id,campaign_id,owner_id,name) values($1,$2,$3,'Waiting Hero')",
      [waitingCharacter, campaign, waiting],
    );
    assert.equal(
      (
        await db.query<{ xp: number }>(
          "select xp from characters where id=$1",
          [waitingCharacter],
        )
      ).rows[0].xp,
      10,
    );
    assert.equal(
      (
        await db.query<{ chest_pending_xp: number }>(
          "select chest_pending_xp from campaign_members where campaign_id=$1 and user_id=$2",
          [campaign, waiting],
        )
      ).rows[0].chest_pending_xp,
      0,
    );

    const temporaryReward = crypto.randomUUID();
    await db.exec("reset role");
    await db.query(
      "insert into chest_rewards(id,campaign_id,rarity,reward_type,label,amount,weight) values($1,$2,'common','xp','Temporário',1,1)",
      [temporaryReward, campaign],
    );
    await asUser(player);
    await assert.rejects(
      db.query("select chest_admin_action($1,'reward_delete',$2::jsonb)", [
        campaign,
        JSON.stringify({ id: temporaryReward }),
      ]),
      /Somente Pink/,
    );
    await asUser(master);
    await db.query("select chest_admin_action($1,'reward_delete',$2::jsonb)", [
      campaign,
      JSON.stringify({ id: temporaryReward }),
    ]);
    assert.equal(
      (
        await db.query<{ count: number }>(
          "select count(*)::int count from chest_rewards where id=$1",
          [temporaryReward],
        )
      ).rows[0].count,
      0,
    );
  } finally {
    await db.close();
  }
});
