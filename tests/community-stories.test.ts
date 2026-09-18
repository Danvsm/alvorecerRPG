import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migration = async () =>
  (
    await readFile(
      new URL(
        "../supabase/migrations/20260918001451_orkutista_stories.sql",
        import.meta.url,
      ),
      "utf8",
    )
  ).split("-- Production scheduler:")[0];

const likesMigration = async () =>
  readFile(
    new URL(
      "../supabase/migrations/20260918042726_story_likes_and_audience.sql",
      import.meta.url,
    ),
    "utf8",
  );

const likesHardeningMigration = async () =>
  readFile(
    new URL(
      "../supabase/migrations/20260918042834_story_likes_advisor_hardening.sql",
      import.meta.url,
    ),
    "utf8",
  );

test("Stories enforce identity, likes, private audience and expiration", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role bypassrls;
      create schema auth;
      create schema storage;
      create schema alvorecer_private;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as
        $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      create table public.campaigns(id uuid primary key);
      create table public.profiles(id uuid primary key,username text not null);
      create table public.campaign_members(
        campaign_id uuid not null references campaigns,
        user_id uuid not null references auth.users,
        role text not null,
        primary key(campaign_id,user_id)
      );
      create table public.social_identities(
        id uuid primary key,
        campaign_id uuid not null references campaigns,
        user_id uuid references auth.users,
        kind text not null,
        name text not null,
        active boolean not null default true
      );
      create table public.campaign_events(
        campaign_id uuid primary key references campaigns,
        revision bigint not null default 0
      );
      create function public.is_member(c uuid) returns boolean language sql stable as
        $$select exists(select 1 from campaign_members where campaign_id=c and user_id=auth.uid())$$;
      create function public.is_master(c uuid) returns boolean language sql stable as
        $$select exists(select 1 from campaign_members where campaign_id=c and user_id=auth.uid() and role='master')$$;
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
        $$select split_part(path,'.',2)$$;
      grant usage on schema public,auth,storage to authenticated,service_role;
      grant execute on function auth.uid() to authenticated,service_role;
      grant select on public.campaign_members,public.social_identities to authenticated;
      grant select,insert,delete on storage.objects to authenticated,service_role;
    `);
    await db.exec(await migration());
    await db.exec(await likesMigration());
    await db.exec(await likesHardeningMigration());

    const campaign = crypto.randomUUID();
    const master = crypto.randomUUID();
    const player = crypto.randomUUID();
    const other = crypto.randomUUID();
    const masterIdentity = crypto.randomUUID();
    const playerIdentity = crypto.randomUUID();
    const otherIdentity = crypto.randomUUID();
    const npcIdentity = crypto.randomUUID();
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
       values($1,$2,$3,'master','Pink'),($4,$2,$5,'player','darkvsm'),
       ($6,$2,$7,'player','Gabriel'),($8,$2,null,'npc','Varyn')`,
      [
        masterIdentity,
        campaign,
        master,
        playerIdentity,
        player,
        otherIdentity,
        other,
        npcIdentity,
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
          "select community_story_action($1,$2,$3::jsonb) value",
          [campaign, op, JSON.stringify(details)],
        )
      ).rows[0].value;
    const audience = async (storyId: string, actorId: string) =>
      db.query<{
        identity_id: string;
        viewed_at: string | null;
        liked_at: string | null;
      }>("select * from community_story_audience($1,$2,$3)", [
        campaign,
        storyId,
        actorId,
      ]);

    await asUser(player);
    const firstPath = `${campaign}/${playerIdentity}/${crypto.randomUUID()}.webp`;
    const secondPath = `${campaign}/${playerIdentity}/${crypto.randomUUID()}.webp`;
    await db.query(
      "insert into storage.objects(name,bucket_id) values($1,'community-stories'),($2,'community-stories')",
      [firstPath, secondPath],
    );
    await assert.rejects(
      action("create_story", {
        actor_id: otherIdentity,
        image_path: firstPath,
      }),
      /Identidade inválida/,
    );

    const first = await action("create_story", {
      actor_id: playerIdentity,
      image_path: firstPath,
    });
    const second = await action("create_story", {
      actor_id: playerIdentity,
      image_path: secondPath,
    });
    assert.equal(first.active, true);
    assert.equal(second.active, true);

    let listed = await db.query<{ id: string; viewer_seen: boolean }>(
      "select id,viewer_seen from community_stories($1,$2)",
      [campaign, playerIdentity],
    );
    assert.equal(listed.rows.length, 2);
    assert.equal(
      listed.rows.every((story) => !story.viewer_seen),
      true,
    );

    await action("view_story", {
      actor_id: playerIdentity,
      story_id: first.id,
    });
    await action("view_story", {
      actor_id: playerIdentity,
      story_id: first.id,
    });
    await db.exec("reset role");
    assert.equal(
      (await db.query("select * from community_story_views")).rows.length,
      1,
    );
    await asUser(player);
    listed = await db.query<{ id: string; viewer_seen: boolean }>(
      "select id,viewer_seen from community_stories($1,$2)",
      [campaign, playerIdentity],
    );
    assert.equal(
      listed.rows.find((story) => story.id === first.id)?.viewer_seen,
      true,
    );

    await asUser(other);
    await action("view_story", {
      actor_id: otherIdentity,
      story_id: first.id,
    });
    assert.equal(
      (
        await action("like_story", {
          actor_id: otherIdentity,
          story_id: first.id,
        })
      ).active,
      true,
    );
    assert.equal(
      (
        await action("like_story", {
          actor_id: otherIdentity,
          story_id: first.id,
        })
      ).active,
      false,
    );
    assert.equal(
      (
        await action("like_story", {
          actor_id: otherIdentity,
          story_id: first.id,
        })
      ).active,
      true,
    );
    await assert.rejects(db.query("select * from community_story_likes"));
    await assert.rejects(
      audience(first.id, otherIdentity),
      /Sem permissão para ver o público/,
    );
    const otherListing = await db.query<{
      id: string;
      viewer_liked: boolean;
      like_count: bigint;
      view_count: bigint;
    }>(
      "select id,viewer_liked,like_count,view_count from community_stories($1,$2)",
      [campaign, otherIdentity],
    );
    const otherFirst = otherListing.rows.find((story) => story.id === first.id);
    assert.equal(otherFirst?.viewer_liked, true);
    assert.equal(Number(otherFirst?.like_count), 0);
    assert.equal(Number(otherFirst?.view_count), 0);
    await assert.rejects(
      action("delete_story", {
        actor_id: otherIdentity,
        story_id: first.id,
      }),
      /Sem permissão para excluir/,
    );

    await asUser(player);
    const authorListing = await db.query<{
      id: string;
      like_count: bigint;
      view_count: bigint;
    }>("select id,like_count,view_count from community_stories($1,$2)", [
      campaign,
      playerIdentity,
    ]);
    const authorFirst = authorListing.rows.find(
      (story) => story.id === first.id,
    );
    assert.equal(Number(authorFirst?.like_count), 1);
    assert.equal(Number(authorFirst?.view_count), 2);
    const authorAudience = await audience(first.id, playerIdentity);
    const otherActivity = authorAudience.rows.find(
      (member) => member.identity_id === otherIdentity,
    );
    assert.ok(otherActivity?.viewed_at);
    assert.ok(otherActivity?.liked_at);

    await asUser(master);
    assert.equal((await audience(first.id, masterIdentity)).rows.length, 2);
    const deleted = await action("delete_story", {
      actor_id: masterIdentity,
      story_id: first.id,
    });
    assert.equal(deleted.image_path, firstPath);
    await db.exec("reset role");
    assert.equal(
      (await db.query("select * from community_story_views")).rows.length,
      0,
    );
    assert.equal(
      (await db.query("select * from community_story_likes")).rows.length,
      0,
    );
    assert.equal(
      (
        await db.query(
          "select * from community_story_cleanup where image_path=$1",
          [firstPath],
        )
      ).rows.length,
      1,
    );
    await asUser(master);
    await db.query(
      "delete from storage.objects where bucket_id='community-stories' and name=$1",
      [firstPath],
    );
    await action("confirm_story_cleanup", {
      actor_id: masterIdentity,
      image_path: firstPath,
    });
    await db.exec("reset role");
    assert.equal(
      (
        await db.query(
          "select * from community_story_cleanup where image_path=$1",
          [firstPath],
        )
      ).rows.length,
      0,
    );

    await asUser(master);
    const npcPath = `${campaign}/${npcIdentity}/${crypto.randomUUID()}.webp`;
    await assert.rejects(
      db.query(
        "insert into storage.objects(name,bucket_id) values($1,'community-stories')",
        [npcPath],
      ),
    );
    await assert.rejects(
      action("create_story", {
        actor_id: npcIdentity,
        image_path: npcPath,
      }),
      /Identidade inválida/,
    );

    await db.exec("reset role");
    const expiredPath = `${campaign}/${playerIdentity}/${crypto.randomUUID()}.webp`;
    await db.query(
      `insert into community_stories(
        campaign_id,author_id,image_path,created_at,expires_at
       ) values($1,$2,$3,now()-interval '25 hours',now()-interval '1 hour')`,
      [campaign, playerIdentity, expiredPath],
    );
    await asUser(player);
    listed = await db.query<{ id: string; viewer_seen: boolean }>(
      "select id,viewer_seen from community_stories($1,$2)",
      [campaign, playerIdentity],
    );
    assert.equal(listed.rows.length, 1);
  } finally {
    await db.close();
  }
});

test("Stories UI keeps creation, activity privacy and cleanup together", async () => {
  const [
    stories,
    panel,
    media,
    baseMigration,
    activityMigration,
    activityHardening,
    cleanup,
  ] = await Promise.all([
    readFile(
      new URL("../components/CommunityStories.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../components/CommunityPanel.tsx", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../lib/media.ts", import.meta.url), "utf8"),
    migration(),
    likesMigration(),
    likesHardeningMigration(),
    readFile(
      new URL(
        "../supabase/functions/alvorecer-api/media-cleanup.ts",
        import.meta.url,
      ),
      "utf8",
    ),
  ]);
  const migrationSource = `${baseMigration}\n${activityMigration}\n${activityHardening}`;
  const composerAssets = await Promise.all(
    [
      "story-composer-arch.webp",
      "story-composer-gallery.webp",
      "story-composer-pages.webp",
    ].map((asset) =>
      readFile(new URL(`../public/community/${asset}`, import.meta.url)),
    ),
  );

  assert.match(panel, /<CommunityStories/);
  assert.match(panel, /onClick=\{revealCreate\}/);
  assert.doesNotMatch(panel, /Nova publicação/);
  assert.match(stories, /Seu story/);
  assert.match(stories, /<IdentityAvatar/);
  assert.match(stories, /community_story_action/);
  assert.match(stories, /create_story/);
  assert.match(stories, /view_story/);
  assert.match(stories, /like_story/);
  assert.match(stories, /community_story_audience/);
  assert.match(stories, /aria-pressed/);
  assert.match(stories, /Visualizou/);
  assert.match(stories, /Curtiu/);
  assert.match(stories, /delete_story/);
  assert.match(stories, /STORY_DURATION = 6000/);
  assert.match(stories, /Story anterior/);
  assert.match(stories, /Próximo Story/);
  assert.match(stories, /Adicionar ao story/);
  assert.match(stories, /capture="environment"/);
  assert.match(stories, /Abrir galeria/);
  assert.match(stories, /Prévia do Story/);
  assert.equal(
    composerAssets.every((asset) => asset.length < 128 * 1024),
    true,
  );
  assert.match(media, /uploadCommunityStoryImage/);
  assert.match(migrationSource, /interval '24 hours'/);
  assert.match(migrationSource, /primary key\(story_id,identity_id\)/);
  assert.match(migrationSource, /community_story_likes/);
  assert.match(migrationSource, /community_story_likes_no_direct_access/);
  assert.match(
    migrationSource,
    /story\.author_id<>actor\.id and not public\.is_master\(c\)/,
  );
  assert.match(
    cleanup,
    /storage[\s\S]*from\("community-stories"\)[\s\S]*remove/,
  );
});
