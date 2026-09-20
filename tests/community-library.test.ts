import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const files = async () =>
  Promise.all([
    readFile(
      new URL("../components/CommunityLibrary.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../components/CommunityPanel.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL(
        "../supabase/migrations/20260920142044_community_editorial_articles.sql",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL(
        "../supabase/migrations/20260920154202_allow_player_editorials.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  ]);

test("all four Explore cards open an editorial collection", async () => {
  const [library, panel] = await files();

  assert.match(panel, /revealLibrary\(category\.id as EditorialCategory\)/);
  assert.match(panel, /revealLibrary\("world_history"\)/);
  assert.match(panel, /view === "library"/);
  assert.match(panel, /<CommunityLibrary/);
  assert.match(library, /world_legends/);
  assert.match(library, /players/);
  assert.match(library, /character_stories/);
  assert.match(library, /world_history/);
});

test("the editorial experience lets players write only in their collection", async () => {
  const [library] = await files();

  assert.match(library, /category === "players"/);
  assert.match(library, /playerArticleCount >= 3/);
  assert.match(library, /article\.created_by === currentUserId/);
  assert.match(library, /Segure uma história sua para editar/);
  assert.match(library, /archive=\{master \?/);
  assert.match(library, /remove=\{master \?/);
  assert.match(library, /"Escrever história"/);
  assert.match(library, /maxLength=\{limits\.title\}/);
  assert.match(library, /maxLength=\{limits\.summary\}/);
  assert.match(library, /maxLength=\{limits\.body\}/);
  assert.match(library, /body: 20000/);
  assert.match(library, /community_article_action/);
  assert.match(library, /community_articles/);
  assert.match(library, /\.download\(path\)/);
  assert.match(library, /URL\.createObjectURL/);
  assert.match(library, /URL\.revokeObjectURL/);
  assert.match(library, /unoptimized/);
  assert.match(library, /Segure um card para gerenciar/);
  assert.match(library, /onPointerDown/);
  assert.match(library, />Editar</);
  assert.match(library, />Arquivar</);
  assert.match(library, />Excluir</);
  assert.doesNotMatch(library, /styles\.cardActions/);
});

test("editorial previews stay inside narrow mobile viewports", async () => {
  const styles = await readFile(
    new URL("../components/CommunityLibrary.module.css", import.meta.url),
    "utf8",
  );

  assert.match(styles, /\.storyCard > button \{[\s\S]*?display: block/);
  assert.match(styles, /\.storyCard > button \{[\s\S]*?min-width: 0/);
  assert.match(styles, /\.cardCopy \{[\s\S]*?min-width: 0/);
  assert.match(styles, /\.cardCopy strong \{[\s\S]*?overflow-wrap: anywhere/);
  assert.match(styles, /\.cardCopy > span \{[\s\S]*?overflow-wrap: anywhere/);
});

test("editorial tables, RPC and media are protected in Supabase", async () => {
  const [, , migration, playerMigration] = await files();

  assert.match(migration, /create table public\.community_articles/);
  assert.match(
    migration,
    /alter table public\.community_articles enable row level security/,
  );
  assert.match(migration, /public\.is_member\(campaign_id\)/);
  assert.match(migration, /public\.is_master\(c\)/);
  assert.match(migration, /'community-articles'/);
  assert.match(migration, /community_article_media_insert/);
  assert.match(migration, /community_article_media_read/);
  assert.match(migration, /char_length\(btrim\(body\)\) between 50 and 20000/);
  assert.match(
    migration,
    /revoke all on function public\.community_article_action/,
  );
  assert.doesNotMatch(migration, /grant execute[\s\S]*?to anon/);
  assert.match(playerMigration, /article_category<>'players'/);
  assert.match(playerMigration, /created_by=caller_id/);
  assert.match(playerMigration, />=3/);
  assert.match(playerMigration, /pg_advisory_xact_lock/);
  assert.match(playerMigration, /Somente Pink pode excluir histórias/);
  assert.match(playerMigration, /community_article_player_status/);
  assert.match(
    playerMigration,
    /storage\.extension\(storage\.objects\.name\)='webp'/,
  );
});

test("players can create three own articles, edit them and cannot delete", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role bypassrls;
      create schema auth;
      create schema storage;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as
        $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      create table public.campaigns(id uuid primary key);
      create table public.campaign_members(
        campaign_id uuid not null references public.campaigns(id),
        user_id uuid not null references auth.users(id),
        role text not null,
        primary key(campaign_id,user_id)
      );
      create function public.is_member(c uuid) returns boolean language sql stable
        security definer set search_path=public as
        $$select exists(select 1 from campaign_members where campaign_id=c and user_id=auth.uid())$$;
      create function public.is_master(c uuid) returns boolean language sql stable
        security definer set search_path=public as
        $$select exists(select 1 from campaign_members where campaign_id=c and user_id=auth.uid() and role='master')$$;
      create function public.record_event(
        c uuid,ch uuid,action text,detail jsonb,actor uuid default null
      ) returns void language plpgsql security definer as $$begin return; end$$;
      create table storage.buckets(
        id text primary key,
        name text,
        public boolean,
        file_size_limit bigint,
        allowed_mime_types text[]
      );
      create table storage.objects(name text primary key,bucket_id text not null);
      alter table storage.objects enable row level security;
      create function storage.foldername(path text) returns text[] language sql immutable as
        $$select string_to_array(regexp_replace(path,'/[^/]+$',''),'/')$$;
      create function storage.extension(path text) returns text language sql immutable as
        $$select split_part(path,'.',array_length(string_to_array(path,'.'),1))$$;
      grant usage on schema public,auth,storage to authenticated,service_role;
      grant execute on function auth.uid(),public.is_member(uuid),public.is_master(uuid)
        to authenticated,service_role;
      grant select on public.campaigns,public.campaign_members to authenticated;
      grant select,insert,delete on storage.objects to authenticated,service_role;
    `);
    const [, , baseMigration, playerMigration] = await files();
    await db.exec(baseMigration);
    await db.exec(playerMigration);

    const campaign = crypto.randomUUID();
    const master = crypto.randomUUID();
    const player = crypto.randomUUID();
    const other = crypto.randomUUID();
    await db.query("insert into auth.users(id) values($1),($2),($3)", [
      master,
      player,
      other,
    ]);
    await db.query("insert into campaigns(id) values($1)", [campaign]);
    await db.query(
      `insert into campaign_members(campaign_id,user_id,role)
       values($1,$2,'master'),($1,$3,'player'),($1,$4,'player')`,
      [campaign, master, player, other],
    );

    const asUser = async (user: string) => {
      await db.exec("reset role");
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
        user,
      ]);
      await db.exec("set role authenticated");
    };
    const action = async (op: string, details: Record<string, unknown>) =>
      (
        await db.query<{ result: Record<string, unknown> }>(
          "select community_article_action($1,$2,$3::jsonb) result",
          [campaign, op, JSON.stringify(details)],
        )
      ).rows[0].result;
    const details = (path: string, suffix: string) => ({
      category: "players",
      title: `Jornada ${suffix}`,
      summary: "Uma história pessoal registrada no arquivo.",
      body: "Esta é uma história longa o bastante para validar a publicação do jogador no arquivo.",
      cover_path: path,
    });

    await asUser(player);
    const paths = Array.from(
      { length: 4 },
      () => `${campaign}/editorial/${player}/${crypto.randomUUID()}.webp`,
    );
    for (const path of paths)
      await db.query(
        "insert into storage.objects(name,bucket_id) values($1,'community-articles')",
        [path],
      );
    await assert.rejects(
      db.query(
        "insert into storage.objects(name,bucket_id) values($1,'community-articles')",
        [`${campaign}/editorial/${other}/${crypto.randomUUID()}.webp`],
      ),
      /row-level security/,
    );
    await assert.rejects(
      action("create", {
        ...details(paths[0], "fora"),
        category: "world_legends",
      }),
      /só podem publicar no card Jogadores/,
    );

    const created = [];
    for (let index = 0; index < 3; index += 1)
      created.push(
        await action("create", details(paths[index], String(index + 1))),
      );
    const status = (
      await db.query<{ result: { count: number; can_create: boolean } }>(
        "select community_article_player_status($1) result",
        [campaign],
      )
    ).rows[0].result;
    assert.equal(status.count, 3);
    assert.equal(status.can_create, false);
    await assert.rejects(
      action("create", details(paths[3], "quatro")),
      /limite de 3 histórias/,
    );

    const firstId = String(created[0].article_id);
    await action("update", { id: firstId, title: "Jornada revisada" });
    await assert.rejects(action("archive", { id: firstId }), /Somente Pink/);
    await assert.rejects(action("delete", { id: firstId }), /Somente Pink/);

    await asUser(other);
    await assert.rejects(
      action("update", { id: firstId, title: "História tomada" }),
      /só pode editar suas histórias/,
    );

    await asUser(master);
    await action("delete", { id: firstId });
  } finally {
    await db.close();
  }
});
