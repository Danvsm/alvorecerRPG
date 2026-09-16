import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const master = "00000000-0000-4000-8000-000000000001";
const playerA = "00000000-0000-4000-8000-000000000002";
const playerB = "00000000-0000-4000-8000-000000000003";

async function migration(name: string) {
  return (
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
}

test("player combat damage is atomic and server-enforced", async () => {
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
      grant execute on function auth.uid() to anon,authenticated,service_role;
    `);
    await db.exec(await migration("001_core.sql"));
    await db.exec(await migration("002_accounts.sql"));
    await db.exec(await migration("20260916052558_combat_player_damage.sql"));

    await db.query("insert into auth.users(id) values($1),($2),($3)", [
      master,
      playerA,
      playerB,
    ]);
    const campaign = (
      await db.query<{ id: string }>(
        "select bootstrap_campaign($1,'pink','pink@invalid','cipher') id",
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
            `${username}@invalid`,
            JSON.stringify({ name: username, life: 30, mana: 20, stamina: 20 }),
          ],
        )
      ).rows[0].id;
    const characterA = await createPlayer(playerA, "gabriel");
    const characterB = await createPlayer(playerB, "maria");

    const room = (
      await db.query<{ id: string }>(
        "insert into combat_rooms(campaign_id,name) values($1,'Teste') returning id",
        [campaign],
      )
    ).rows[0].id;
    const inactiveRoom = (
      await db.query<{ id: string }>(
        "insert into combat_rooms(campaign_id,name,active) values($1,'Encerrada',false) returning id",
        [campaign],
      )
    ).rows[0].id;
    const allyA = (
      await db.query<{ id: string }>(
        "insert into combat_participants(room_id,character_id,name,side) values($1,$2,'Gabriel','ally') returning id",
        [room, characterA],
      )
    ).rows[0].id;
    const enemy = (
      await db.query<{ id: string }>(
        "insert into combat_participants(room_id,name,side,life,life_max) values($1,'Goblin','enemy',20,20) returning id",
        [room],
      )
    ).rows[0].id;
    const inactiveEnemy = (
      await db.query<{ id: string }>(
        "insert into combat_participants(room_id,name,side,life,life_max) values($1,'Espectro','enemy',20,20) returning id",
        [inactiveRoom],
      )
    ).rows[0].id;

    async function asUser(user: string) {
      await db.exec("reset role");
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
        user,
      ]);
      await db.exec("set role authenticated");
    }
    const damage = (participantId: string, amount: number) =>
      db.query("select combat_damage($1,$2::jsonb)", [
        campaign,
        JSON.stringify({ participant_id: participantId, amount }),
      ]);

    await asUser(playerA);
    await damage(enemy, 7);
    await db.exec("reset role");
    assert.equal(
      (
        await db.query<{ life: number }>(
          "select life from combat_participants where id=$1",
          [enemy],
        )
      ).rows[0].life,
      13,
    );
    await asUser(playerA);
    await assert.rejects(damage(allyA, 1), /Inimigo indisponível/);
    await assert.rejects(damage(inactiveEnemy, 1), /Inimigo indisponível/);
    for (const amount of [0, -1, 1.5, 100001]) {
      await assert.rejects(damage(enemy, amount));
    }

    await asUser(playerB);
    await assert.rejects(
      damage(enemy, 1),
      /Seu personagem não participa deste combate/,
    );

    await db.exec("reset role");
    const characterEnemy = (
      await db.query<{ id: string }>(
        "insert into characters(campaign_id,owner_id,name) values($1,$2,'Rival') returning id",
        [campaign, master],
      )
    ).rows[0].id;
    await db.query(
      "insert into character_resources(character_id,key,current,maximum) values($1,'life',25,25)",
      [characterEnemy],
    );
    const characterTarget = (
      await db.query<{ id: string }>(
        "insert into combat_participants(room_id,character_id,name,side) values($1,$2,'Rival','enemy') returning id",
        [room, characterEnemy],
      )
    ).rows[0].id;

    await asUser(playerA);
    await damage(characterTarget, 9);
    await db.exec("reset role");
    assert.equal(
      (
        await db.query<{ current: number }>(
          "select current from character_resources where character_id=$1 and key='life'",
          [characterEnemy],
        )
      ).rows[0].current,
      16,
    );

    await asUser(master);
    await assert.rejects(
      damage(enemy, 1),
      /Ação disponível apenas para jogadores/,
    );
    assert.equal(characterB.length > 0, true);
  } finally {
    await db.close();
  }
});
