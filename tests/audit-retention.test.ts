import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

test("history retention deletes only expired logs, preserves wallet entries and respects campaign access", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role authenticated;
      create table public.audit_logs(id bigint primary key, campaign_id integer, created_at timestamptz);
      create table public.dracma_transactions(id integer primary key, amount_cents integer,
        audit_log_id bigint references public.audit_logs(id) on delete set null);
      alter table public.audit_logs enable row level security;
      grant select on public.audit_logs to authenticated;
      create policy read_policy on public.audit_logs for select to authenticated
        using (campaign_id = 1);
      create schema cron;
      create function cron.schedule(text,text,text) returns bigint language sql as $$select 1::bigint$$;
      begin;
      insert into public.audit_logs values
        (1,1,now()-interval '31 days'),
        (2,1,now()-interval '30 days'),
        (3,1,now()-interval '1 day'),
        (4,2,now()-interval '1 day');
      insert into public.dracma_transactions values (1,2500,1);
    `);
    const migration = readFileSync(new URL("../supabase/migrations/20260926222134_audit_history_retention.sql", import.meta.url), "utf8");
    await db.exec(migration.split("-- Stop bundling history")[0]);
    assert.deepEqual((await db.query("select id from public.audit_logs order by id")).rows, [{id:2},{id:3},{id:4}]);
    assert.deepEqual((await db.query("select amount_cents,audit_log_id from public.dracma_transactions")).rows,
      [{amount_cents:2500,audit_log_id:null}]);
    // A record that expires between cleanup runs is hidden by the restrictive policy.
    await db.exec("insert into public.audit_logs values(5,1,now()-interval '31 days'); set local role authenticated;");
    assert.deepEqual((await db.query("select id from public.audit_logs order by id")).rows, [{id:2},{id:3}]);
    await assert.rejects(db.query("delete from public.audit_logs"), /permission denied/);
    await db.exec("rollback;");
  } finally {
    await db.close();
  }
});
