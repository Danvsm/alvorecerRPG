import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { encrypt, decrypt } from "../lib/crypto";
const master = "00000000-0000-4000-8000-000000000001",
  player = "00000000-0000-4000-8000-000000000002",
  other = "00000000-0000-4000-8000-000000000003";
test("credential encryption authenticates both ciphertext and user", () => {
  process.env.CREDENTIAL_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString(
    "base64",
  );
  const value = encrypt("batata123", player);
  assert.equal(decrypt(value, player), "batata123");
  assert.throws(() => decrypt(value, other));
  assert.throws(() => decrypt(value.slice(0, -4) + "AAAA", player));
  assert.ok(!value.includes("batata123"));
});
test("database permission boundaries, purchases, combat visibility and invitations", async (t) => {
  const db = new PGlite();
  await db.exec(
    `create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create table auth.users(id uuid primary key,email text,encrypted_password text); create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$; grant usage on schema public,auth to anon,authenticated,service_role; grant execute on function auth.uid() to anon,authenticated,service_role;`,
  );
  for (const f of ["001_core.sql", "002_accounts.sql", "004_auth_guard.sql"]) {
    let sql = await readFile(
      new URL("../supabase/migrations/" + f, import.meta.url),
      "utf8",
    );
    sql = sql
      .replace("create extension if not exists pgcrypto;", "")
      .replace(
        "alter publication supabase_realtime add table public.campaign_events;",
        "",
      );
    await db.exec(sql);
  }
  await db.query("insert into auth.users(id) values($1),($2),($3)", [
    master,
    player,
    other,
  ]);
  const b = await db.query<{ c: string }>(
    "select bootstrap_campaign($1,'mestre','master@auth.invalid','encrypted') c",
    [master],
  );
  const c = b.rows[0].c;
  const make = async (u: string, n: string) =>
    (
      await db.query<{ id: string }>(
        "select provision_player($1,$2,$3,$4,'cipher',$5::jsonb,null) id",
        [
          c,
          u,
          n,
          n + "@auth.invalid",
          JSON.stringify({
            name: n,
            life: 60,
            mana: 20,
            stamina: 30,
            xp: 200,
            money: 100,
          }),
        ],
      )
    ).rows[0].id;
  const ch = await make(player, "arthur"),
    ch2 = await make(other, "gabriel");
  async function asUser(id: string) {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
    await db.exec("set role authenticated");
  }
  async function cmd(op: string, d: object) {
    return db.query("select game_command($1,$2,$3::jsonb)", [
      c,
      op,
      JSON.stringify(d),
    ]);
  }
  await t.test(
    "player reads own character but cannot read another or credential vault",
    async () => {
      await asUser(player);
      assert.equal((await db.query("select * from characters")).rows.length, 1);
      assert.equal(
        (await db.query("select * from characters where id=$1", [ch2])).rows
          .length,
        0,
      );
      await assert.rejects(db.query("select * from credential_vault"));
      await assert.rejects(db.query("select throttle('x',100)"));
      await assert.rejects(
        db.query("select record_event($1,null,'fake','{}')", [c]),
      );
    },
  );
  await t.test(
    "spend own resources; reject healing, others, balances and direct writes",
    async () => {
      await cmd("resource", { character_id: ch, key: "life", delta: -12 });
      const r = await db.query<{ current: number }>(
        "select current from character_resources where character_id=$1 and key='life'",
        [ch],
      );
      assert.equal(r.rows[0].current, 48);
      await assert.rejects(
        cmd("resource", { character_id: ch, key: "life", delta: 2 }),
      );
      await assert.rejects(
        cmd("resource", { character_id: ch2, key: "life", delta: -2 }),
      );
      await assert.rejects(
        cmd("balance", { character_id: ch, key: "xp", delta: 100 }),
      );
      await assert.rejects(
        db.query("update characters set xp=500 where id=$1", [ch]),
      );
    },
  );
  let aid: string;
  await t.test(
    "advantage purchase is atomic and duplicate purchase cannot spend twice",
    async () => {
      await asUser(master);
      await cmd("advantage", { name: "Visão Aguçada", cost: 150 });
      aid = (
        await db.query<{ id: string }>(
          "select id from advantages where name='Visão Aguçada'",
        )
      ).rows[0].id;
      await asUser(player);
      await cmd("buy", { character_id: ch, advantage_id: aid });
      await assert.rejects(cmd("buy", { character_id: ch, advantage_id: aid }));
      assert.equal(
        (
          await db.query<{ xp: number }>(
            "select xp from characters where id=$1",
            [ch],
          )
        ).rows[0].xp,
        50,
      );
      assert.equal(
        (await db.query("select * from character_advantages")).rows.length,
        1,
      );
      await asUser(master);
      await cmd("balance", { character_id: ch, key: "xp", delta: 200 });
      await asUser(player);
      await assert.rejects(cmd("buy", { character_id: ch, advantage_id: aid }));
      assert.equal(
        (
          await db.query<{ xp: number }>(
            "select xp from characters where id=$1",
            [ch],
          )
        ).rows[0].xp,
        250,
      );
    },
  );
  await t.test(
    "rename/archive preserves attribute identity and values",
    async () => {
      await asUser(master);
      const a = (
        await db.query<{ id: string }>(
          "select id from attributes where name='Habilidade'",
        )
      ).rows[0].id;
      await cmd("attribute_value", {
        character_id: ch,
        attribute_id: a,
        value: 4,
      });
      await cmd("attribute", {
        id: a,
        name: "Destreza",
        active: false,
        position: 9,
      });
      assert.equal(
        (
          await db.query<{ value: number }>(
            "select value from character_attributes where character_id=$1 and attribute_id=$2",
            [ch, a],
          )
        ).rows[0].value,
        4,
      );
    },
  );
  await t.test(
    "independent creatures, server-side hidden values and master healing",
    async () => {
      await asUser(master);
      await cmd("room", { name: "Ruínas" });
      await cmd("creature", { name: "Goblin", life: 20, stamina: 10 });
      const room = (
          await db.query<{ id: string }>("select id from combat_rooms")
        ).rows[0].id,
        template = (
          await db.query<{ id: string }>("select id from creature_templates")
        ).rows[0].id;
      await cmd("participant", {
        room_id: room,
        template_id: template,
        name: "Goblin 1",
      });
      await cmd("participant", {
        room_id: room,
        template_id: template,
        name: "Goblin 2",
      });
      const ps = (
        await db.query<{ id: string }>(
          "select id from combat_participants order by name",
        )
      ).rows;
      await cmd("combat_update", { id: ps[0].id, key: "life", delta: -16 });
      const snap = async () =>
        (await db.query<{ v: any[] }>("select combat_snapshot($1) v", [c]))
          .rows[0].v;
      assert.equal((await snap()).find((p) => p.id === ps[0].id).life, 4);
      assert.equal((await snap()).find((p) => p.id === ps[1].id).life, 20);
      await asUser(player);
      assert.equal(
        (await db.query("select * from combat_participants")).rows.length,
        0,
      );
      assert.equal(
        (await db.query("select * from creature_templates")).rows.length,
        0,
      );
      const hidden = (await snap()).find((p) => p.id === ps[0].id);
      assert.equal(hidden.life, null);
      assert.equal(hidden.life_max, null);
      assert.equal(hidden.mana, null);
      assert.equal(hidden.state, "red");
      await assert.rejects(
        cmd("combat_update", { id: ps[0].id, reveal: true }),
      );
      await asUser(master);
      await cmd("combat_update", { id: ps[0].id, reveal: true });
      await cmd("resource", { character_id: ch, key: "life", delta: 10 });
      await asUser(player);
      assert.equal((await snap()).find((p) => p.id === ps[0].id).life, 4);
    },
  );
  await t.test("campaign isolation and audit visibility", async () => {
    await db.exec("reset role");
    const c2 = (
      await db.query<{ id: string }>(
        "insert into campaigns(name) values('Outra') returning id",
      )
    ).rows[0].id;
    await asUser(player);
    await assert.rejects(db.query("select combat_snapshot($1)", [c2]));
    assert.equal(
      (await db.query("select * from audit_logs where character_id is null"))
        .rows.length,
      0,
    );
    assert.ok((await db.query("select * from audit_logs")).rows.length > 0);
  });
  await t.test(
    "invites are claimed once and cancelled/expired links are rejected",
    async () => {
      await db.exec("reset role");
      await db.query(
        "insert into invites(campaign_id,token_hash,expires_at) values($1,'token',now()+interval '1 day'),($1,'expired',now()-interval '1 day')",
        [c],
      );
      await db.query("select claim_invite('token',$1)", [player]);
      await assert.rejects(
        db.query("select claim_invite('token',$1)", [other]),
      );
      await assert.rejects(
        db.query("select claim_invite('expired',$1)", [other]),
      );
    },
  );
  await t.test(
    "password workflow cannot be skipped through Auth updates",
    async () => {
      await db.exec("reset role");
      await assert.rejects(
        db.query(
          "update auth.users set encrypted_password='outside' where id=$1",
          [player],
        ),
      );
      await assert.rejects(
        db.query(
          "update auth.users set email='outside@example.com' where id=$1",
          [player],
        ),
      );
      await db.query("select lock_credential($1,'pending')", [player]);
      await assert.rejects(
        db.query("select lock_credential($1,'another')", [player]),
      );
      await db.query(
        "update auth.users set encrypted_password='auth-new-hash' where id=$1",
        [player],
      );
      await db.query("select finish_credential($1,'pending',true)", [player]);
      assert.equal(
        (
          await db.query<{ ciphertext: string }>(
            "select ciphertext from credential_vault where user_id=$1",
            [player],
          )
        ).rows[0].ciphertext,
        "pending",
      );
    },
  );
  await db.close();
});
