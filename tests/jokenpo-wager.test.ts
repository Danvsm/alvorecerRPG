import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

const USER_ID = "00000000-0000-4000-8000-000000000001";
const CAMPAIGN_ID = "00000000-0000-4000-8000-000000000002";
const CHARACTER_ID = "00000000-0000-4000-8000-000000000003";
const REQUEST_ID = "00000000-0000-4000-8000-000000000004";

async function setup() {
  const db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema auth;
    create table public.profiles(id uuid primary key, username text, display_name text);
    create table public.campaigns(id uuid primary key);
    create table public.campaign_members(
      campaign_id uuid references public.campaigns(id),
      user_id uuid references public.profiles(id),
      role text not null,
      access_active boolean not null default true,
      archived_at timestamptz,
      dracmas_cents bigint not null default 0,
      primary key(campaign_id,user_id)
    );
    create table public.characters(
      id uuid primary key,
      campaign_id uuid references public.campaigns(id),
      owner_id uuid references public.profiles(id),
      name text not null,
      archived boolean not null default false,
      dracmas_cents bigint not null default 0,
      money integer not null default 0
    );
    create table public.dracma_transactions(
      id uuid primary key default gen_random_uuid(),
      campaign_id uuid not null references public.campaigns(id),
      kind text not null,
      actor_id uuid references public.profiles(id),
      from_user_id uuid references public.profiles(id),
      from_character_id uuid references public.characters(id),
      from_label text,
      to_user_id uuid references public.profiles(id),
      to_character_id uuid references public.characters(id),
      to_label text,
      amount_cents bigint not null check(amount_cents > 0),
      reason text not null default '',
      from_balance_after bigint,
      to_balance_after bigint,
      constraint dracma_transactions_kind_check check(kind in ('transfer'))
    );
    create function auth.uid() returns uuid language sql stable as
      $$ select '${USER_ID}'::uuid $$;
    create function public.is_master(c uuid) returns boolean language sql stable as
      $$ select false $$;
    create function public.record_event(c uuid, ch uuid, op text, d jsonb)
      returns void language sql as $$ select $$;
  `);

  const migration = await readFile(
    new URL(
      "../supabase/migrations/20260922024037_jokenpo_wagers.sql",
      import.meta.url,
    ),
    "utf8",
  );
  await db.exec(migration);
  await db.exec(`
    insert into public.profiles values ('${USER_ID}', 'jogador', 'Jogador');
    insert into public.campaigns values ('${CAMPAIGN_ID}');
    insert into public.campaign_members(campaign_id,user_id,role,dracmas_cents)
      values ('${CAMPAIGN_ID}','${USER_ID}','player',0);
    insert into public.characters(id,campaign_id,owner_id,name,dracmas_cents,money)
      values ('${CHARACTER_ID}','${CAMPAIGN_ID}','${USER_ID}','Herói',10000,100);
  `);
  return db;
}

test("Jokenpo liquida a rodada uma única vez no servidor", async () => {
  const db = await setup();
  const call = `select public.play_jokenpo(
    '${CAMPAIGN_ID}', '${CHARACTER_ID}', 1000, 'pedra', '${REQUEST_ID}'
  ) as result`;

  const first = await db.query<{ result: Record<string, unknown> }>(call);
  const second = await db.query<{ result: Record<string, unknown> }>(call);
  assert.deepEqual(second.rows[0].result, first.rows[0].result);

  const result = first.rows[0].result;
  assert.ok(["vitoria", "derrota", "empate"].includes(String(result.outcome)));
  assert.ok([800, -1000, 0].includes(Number(result.net_delta_cents)));

  const balance = await db.query<{ dracmas_cents: number }>(
    `select dracmas_cents from public.characters where id='${CHARACTER_ID}'`,
  );
  assert.equal(
    Number(balance.rows[0].dracmas_cents),
    10000 + Number(result.net_delta_cents),
  );

  const counts = await db.query<{ rounds: number; transactions: number }>(`
    select
      (select count(*)::integer from public.jokenpo_rounds) as rounds,
      (select count(*)::integer from public.dracma_transactions) as transactions
  `);
  assert.equal(Number(counts.rows[0].rounds), 1);
  assert.equal(
    Number(counts.rows[0].transactions),
    Number(result.net_delta_cents) === 0 ? 0 : 1,
  );

  await db.close();
});
