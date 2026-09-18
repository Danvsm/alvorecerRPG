import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const migration = async () =>
  readFile(
    new URL(
      "../supabase/migrations/20260917230447_orkutista_feed.sql",
      import.meta.url,
    ),
    "utf8",
  );

const deletionMigration = async () =>
  readFile(
    new URL(
      "../supabase/migrations/20260918033758_delete_orkutista_feed_posts.sql",
      import.meta.url,
    ),
    "utf8",
  );

test("Orkutista feed enforces identity, unique likes and one-level replies", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role;
      create schema auth;
      create schema alvorecer_private;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as
        $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      grant usage on schema auth to authenticated;
      grant execute on function auth.uid() to authenticated;

      create table public.campaigns(id uuid primary key);
      create table public.profiles(
        id uuid primary key references auth.users(id),
        username text not null unique
      );
      create table public.campaign_members(
        campaign_id uuid references public.campaigns(id),
        user_id uuid references public.profiles(id),
        role text not null,
        primary key(campaign_id,user_id)
      );
      create table public.social_identities(
        id uuid primary key,
        campaign_id uuid not null references public.campaigns(id),
        user_id uuid references public.profiles(id),
        kind text not null,
        name text not null,
        subtitle text not null default '',
        active boolean not null default true
      );
      create table public.campaign_events(
        campaign_id uuid primary key references public.campaigns(id),
        revision bigint not null default 0
      );
      create function public.is_member(c uuid) returns boolean language sql stable
        security definer set search_path=public as
        $$select exists(select 1 from campaign_members where campaign_id=c and user_id=auth.uid())$$;
      create function public.is_master(c uuid) returns boolean language sql stable
        security definer set search_path=public as
        $$select exists(select 1 from campaign_members where campaign_id=c and user_id=auth.uid() and role='master')$$;

      create schema storage;
      create table storage.buckets(
        id text primary key,
        name text,
        public boolean,
        file_size_limit bigint,
        allowed_mime_types text[]
      );
      create table storage.objects(
        name text primary key,
        bucket_id text not null
      );
      alter table storage.objects enable row level security;
      create function storage.foldername(path text) returns text[] language sql immutable as
        $$select string_to_array(regexp_replace(path,'/[^/]+$',''),'/')$$;
      create function storage.extension(path text) returns text language sql immutable as
        $$select split_part(path,'.',2)$$;
      grant usage on schema public,storage to authenticated;
      grant select on public.social_identities to authenticated;
      grant select,insert,delete on storage.objects to authenticated;
    `);
    await db.exec(await migration());
    await db.exec(await deletionMigration());

    const campaign = crypto.randomUUID();
    const master = crypto.randomUUID();
    const player = crypto.randomUUID();
    const other = crypto.randomUUID();
    const masterIdentity = crypto.randomUUID();
    const playerIdentity = crypto.randomUUID();
    const otherIdentity = crypto.randomUUID();
    await db.query("insert into auth.users(id) values($1),($2),($3)", [
      master,
      player,
      other,
    ]);
    await db.query("insert into campaigns(id) values($1)", [campaign]);
    await db.query(
      "insert into profiles(id,username) values($1,'pink'),($2,'darkvsm'),($3,'gabriel')",
      [master, player, other],
    );
    await db.query(
      `insert into campaign_members(campaign_id,user_id,role)
       values($1,$2,'master'),($1,$3,'player'),($1,$4,'player')`,
      [campaign, master, player, other],
    );
    await db.query(
      `insert into social_identities(id,campaign_id,user_id,kind,name)
       values($1,$2,$3,'master','Pink'),($4,$2,$5,'player','darkvsm'),($6,$2,$7,'player','Gabriel')`,
      [
        masterIdentity,
        campaign,
        master,
        playerIdentity,
        player,
        otherIdentity,
        other,
      ],
    );
    await db.query("insert into campaign_events(campaign_id) values($1)", [
      campaign,
    ]);

    const asUser = async (id: string) => {
      await db.exec("reset role");
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
        id,
      ]);
      await db.exec("set role authenticated");
    };
    const action = async (op: string, details: Record<string, unknown>) =>
      (
        await db.query<{ value: any }>(
          "select community_feed_action($1,$2,$3::jsonb) value",
          [campaign, op, JSON.stringify(details)],
        )
      ).rows[0].value;

    await asUser(player);
    const imagePath = `${campaign}/${playerIdentity}/${crypto.randomUUID()}.webp`;
    await db.query(
      "insert into storage.objects(name,bucket_id) values($1,'community-posts')",
      [imagePath],
    );
    await assert.rejects(
      db.query(
        "insert into storage.objects(name,bucket_id) values($1,'community-posts')",
        [`${campaign}/${otherIdentity}/${crypto.randomUUID()}.webp`],
      ),
    );
    await assert.rejects(
      db.query(
        "insert into community_posts(campaign_id,author_id,image_path,caption) values($1,$2,'fake.webp','fake')",
        [campaign, otherIdentity],
      ),
    );
    await assert.rejects(
      action("create_post", {
        actor_id: otherIdentity,
        image_path: imagePath,
        caption: "Identidade falsa",
      }),
      /Identidade inválida/,
    );

    const post = await action("create_post", {
      actor_id: playerIdentity,
      image_path: imagePath,
      caption: "A sessão foi ótima.",
    });
    assert.equal(post.active, true);

    assert.equal(
      (
        await action("post_like", {
          actor_id: playerIdentity,
          post_id: post.id,
        })
      ).active,
      true,
    );
    assert.equal(
      (
        await action("post_like", {
          actor_id: playerIdentity,
          post_id: post.id,
        })
      ).active,
      false,
    );
    assert.equal(
      (await db.query("select * from community_post_likes")).rows.length,
      0,
    );

    const root = await action("comment", {
      actor_id: playerIdentity,
      post_id: post.id,
      body: "Essa sessão foi ótima.",
    });
    await asUser(other);
    const reply = await action("comment", {
      actor_id: otherIdentity,
      post_id: post.id,
      parent_id: root.id,
      body: "Também gostei.",
    });
    await assert.rejects(
      action("comment", {
        actor_id: otherIdentity,
        post_id: post.id,
        parent_id: reply.id,
        body: "Terceiro nível.",
      }),
      /Comentário principal inválido/,
    );

    assert.equal(
      (
        await action("comment_like", {
          actor_id: otherIdentity,
          comment_id: root.id,
        })
      ).active,
      true,
    );
    assert.equal(
      (
        await action("comment_like", {
          actor_id: otherIdentity,
          comment_id: root.id,
        })
      ).active,
      false,
    );

    const feed = await db.query<{
      author_username: string;
      like_count: number;
      comment_count: number;
    }>("select * from community_feed($1,$2)", [campaign, otherIdentity]);
    assert.equal(feed.rows[0].author_username, "darkvsm");
    assert.equal(Number(feed.rows[0].like_count), 0);
    assert.equal(Number(feed.rows[0].comment_count), 2);

    const comments = await db.query<{ parent_id: string | null }>(
      "select * from community_post_comments($1,$2,$3)",
      [campaign, post.id, otherIdentity],
    );
    assert.equal(comments.rows.length, 2);
    assert.equal(comments.rows[0].parent_id, null);
    assert.equal(comments.rows[1].parent_id, root.id);

    await assert.rejects(
      action("delete_post", {
        actor_id: otherIdentity,
        post_id: post.id,
      }),
      /Sem permissão para excluir esta publicação/,
    );

    await asUser(player);
    const archived = await action("delete_post", {
      actor_id: playerIdentity,
      post_id: post.id,
    });
    assert.equal(archived.archived, true);
    assert.equal(archived.deleted, false);
    assert.equal(
      (
        await db.query("select * from community_feed($1,$2)", [
          campaign,
          playerIdentity,
        ])
      ).rows.length,
      0,
    );
    await assert.rejects(
      db.query("select * from community_archived_posts($1)", [campaign]),
      /Sem permissão/,
    );

    await asUser(master);
    const archivedPosts = await db.query<{ id: string; expires_at: string }>(
      "select * from community_archived_posts($1)",
      [campaign],
    );
    assert.equal(archivedPosts.rows.length, 1);
    assert.equal(archivedPosts.rows[0].id, post.id);
    assert.ok(
      new Date(archivedPosts.rows[0].expires_at).getTime() > Date.now(),
    );

    const permanent = await action("delete_post", {
      actor_id: masterIdentity,
      post_id: post.id,
    });
    assert.equal(permanent.deleted, true);
    assert.equal(permanent.archived, false);
    assert.equal(permanent.image_path, imagePath);
    await db.query("delete from storage.objects where name=$1", [imagePath]);
    await action("confirm_post_cleanup", {
      actor_id: masterIdentity,
      image_path: imagePath,
    });

    await db.exec("reset role");
    assert.equal(
      (await db.query("select * from community_posts")).rows.length,
      0,
    );
    assert.equal(
      (await db.query("select * from community_post_comments")).rows.length,
      0,
    );
    assert.equal(
      (await db.query("select * from community_comment_likes")).rows.length,
      0,
    );
    assert.equal(
      (await db.query("select * from community_post_cleanup")).rows.length,
      0,
    );
  } finally {
    await db.close();
  }
});

test("community feed UI keeps post media optimized and interactions scoped", async () => {
  const [
    feed,
    archives,
    game,
    media,
    migrationSource,
    deletionSource,
    cleanup,
  ] = await Promise.all([
    readFile(
      new URL("../components/CommunityFeed.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../components/CommunityArchives.tsx", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../components/Game.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/media.ts", import.meta.url), "utf8"),
    migration(),
    deletionMigration(),
    readFile(
      new URL(
        "../supabase/functions/alvorecer-api/media-cleanup.ts",
        import.meta.url,
      ),
      "utf8",
    ),
  ]);

  assert.match(feed, /<IdentityAvatar/);
  assert.match(feed, /community_feed_action/);
  assert.match(feed, /create_post/);
  assert.match(feed, /post_like/);
  assert.match(feed, /comment_like/);
  assert.match(feed, /delete_post/);
  assert.match(feed, /Excluir publicação/);
  assert.match(feed, /master \|\| post\.author_id === actor/);
  assert.match(feed, /parent_id: replyingTo\?\.id \|\| null/);
  assert.doesNotMatch(feed, /video|reel|share/i);
  assert.match(media, /uploadCommunityPostImage/);
  assert.match(media, /1600/);
  assert.match(media, /1024 \* 1024/);
  assert.match(migrationSource, /primary key\(post_id,identity_id\)/);
  assert.match(migrationSource, /primary key\(comment_id,identity_id\)/);
  assert.match(migrationSource, /Respostas aceitam somente um nível/);
  assert.match(deletionSource, /set archived_at=now\(\)/);
  assert.match(deletionSource, /if public\.is_master\(c\) then/);
  assert.match(deletionSource, /community_archived_posts/);
  assert.match(deletionSource, /post\.archived_at\+interval '24 hours'/);
  assert.match(archives, /ÁREA EXCLUSIVA DO MESTRE/);
  assert.match(archives, /tempo restante|Exclusão definitiva em/i);
  assert.match(game, /\["Arquivos", Archive\]/);
  assert.doesNotMatch(
    game.slice(
      game.indexOf("const playerMenu"),
      game.indexOf("function formatHistoryValue"),
    ),
    /Arquivos/,
  );
  assert.match(cleanup, /community_post_cleanup/);
  assert.match(cleanup, /24 \* 60 \* 60 \* 1000/);
});
