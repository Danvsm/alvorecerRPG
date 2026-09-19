import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const migration = () =>
  readFile(
    new URL(
      "../supabase/migrations/20260919190308_community_profile_experience.sql",
      import.meta.url,
    ),
    "utf8",
  );

test("community profile protects biography, follows and public activity", async () => {
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
        active boolean not null default true
      );
      create table public.community_posts(
        id uuid primary key default gen_random_uuid(),
        campaign_id uuid not null references public.campaigns(id),
        author_id uuid not null references public.social_identities(id),
        image_path text,
        caption text not null,
        created_at timestamptz not null default now(),
        archived_at timestamptz
      );
      create table public.community_post_likes(
        post_id uuid references public.community_posts(id) on delete cascade,
        identity_id uuid references public.social_identities(id),
        primary key(post_id,identity_id)
      );
      create table public.community_post_comments(
        id uuid primary key default gen_random_uuid(),
        post_id uuid references public.community_posts(id) on delete cascade,
        author_id uuid references public.social_identities(id)
      );
      create table public.cosmetics(
        id uuid primary key,
        campaign_id uuid not null references public.campaigns(id),
        kind text not null,
        name text not null
      );
      create table public.cosmetic_grants(
        identity_id uuid references public.social_identities(id),
        cosmetic_id uuid references public.cosmetics(id),
        created_at timestamptz not null default now(),
        removed_at timestamptz,
        primary key(identity_id,cosmetic_id)
      );
      create table public.cosmetic_equipment(
        identity_id uuid references public.social_identities(id),
        kind text not null,
        cosmetic_id uuid references public.cosmetics(id),
        primary key(identity_id,kind)
      );
      create table public.notifications(
        id bigint generated always as identity primary key,
        campaign_id uuid not null references public.campaigns(id),
        user_id uuid not null references public.profiles(id),
        kind text not null,
        title text not null,
        reference_id text
      );

      create function public.is_member(c uuid) returns boolean language sql stable
        security definer set search_path=public as
        $$select exists(select 1 from campaign_members where campaign_id=c and user_id=auth.uid())$$;
      create function public.is_master(c uuid) returns boolean language sql stable
        security definer set search_path=public as
        $$select exists(select 1 from campaign_members where campaign_id=c and user_id=auth.uid() and role='master')$$;
      create function alvorecer_private.require_community_actor(c uuid,requested uuid)
      returns public.social_identities language plpgsql stable security definer
      set search_path=public as $$
      declare actor public.social_identities;
      begin
        select * into actor from social_identities
        where id=requested and campaign_id=c and active and user_id=auth.uid();
        if actor.id is null then raise exception 'Identidade inválida'; end if;
        return actor;
      end$$;
      create function public.wealth_ranking(c uuid)
      returns table(rank bigint,identity_id uuid,name text,avatar_id uuid)
      language sql stable security definer set search_path=public as $$
        select row_number() over(order by identity.name),identity.id,identity.name,null::uuid
        from social_identities identity where identity.campaign_id=c and identity.active
      $$;

      grant usage on schema public,auth to authenticated;
      grant execute on function auth.uid(),public.is_member(uuid),public.is_master(uuid)
        to authenticated;
    `);
    await db.exec(await migration());

    const campaign = crypto.randomUUID();
    const viewerUser = crypto.randomUUID();
    const authorUser = crypto.randomUUID();
    const viewer = crypto.randomUUID();
    const author = crypto.randomUUID();
    const medal = crypto.randomUUID();
    const title = crypto.randomUUID();
    await db.query("insert into auth.users(id) values($1),($2)", [
      viewerUser,
      authorUser,
    ]);
    await db.query("insert into campaigns(id) values($1)", [campaign]);
    await db.query(
      "insert into profiles(id,username) values($1,'viewer'),($2,'darkvsm')",
      [viewerUser, authorUser],
    );
    await db.query(
      "insert into campaign_members(campaign_id,user_id,role) values($1,$2,'player'),($1,$3,'player')",
      [campaign, viewerUser, authorUser],
    );
    await db.query(
      `insert into social_identities(id,campaign_id,user_id,kind,name)
       values($1,$2,$3,'player','Viewer'),($4,$2,$5,'player','Darkvsm')`,
      [viewer, campaign, viewerUser, author, authorUser],
    );
    await db.query(
      `insert into cosmetics(id,campaign_id,kind,name)
       values($1,$2,'medal','Luz Persistente'),($3,$2,'title','Portador da Chama')`,
      [medal, campaign, title],
    );
    await db.query(
      `insert into cosmetic_grants(identity_id,cosmetic_id)
       values($1,$2),($1,$3)`,
      [author, medal, title],
    );
    await db.query(
      "insert into cosmetic_equipment(identity_id,kind,cosmetic_id) values($1,'medal',$2)",
      [author, medal],
    );
    const post = (
      await db.query<{ id: string }>(
        "insert into community_posts(campaign_id,author_id,caption) values($1,$2,'Primeiro post') returning id",
        [campaign, author],
      )
    ).rows[0];
    await db.query(
      "insert into community_post_likes(post_id,identity_id) values($1,$2)",
      [post.id, viewer],
    );

    const asUser = async (user: string) => {
      await db.exec("reset role");
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
        user,
      ]);
      await db.exec("set role authenticated");
    };
    const profileAction = async (
      op: string,
      details: Record<string, unknown>,
    ) =>
      (
        await db.query<{ result: any }>(
          "select community_profile_action($1,$2,$3::jsonb) result",
          [campaign, op, JSON.stringify(details)],
        )
      ).rows[0].result;

    await asUser(authorUser);
    const saved = await profileAction("bio", {
      actor_id: author,
      bio: "Entre ruínas e recomeços.",
    });
    assert.equal(saved.bio, "Entre ruínas e recomeços.");
    await assert.rejects(
      profileAction("bio", {
        actor_id: author,
        bio: "a".repeat(241),
      }),
      /até 240 caracteres/,
    );

    await asUser(viewerUser);
    await assert.rejects(
      profileAction("bio", { actor_id: author, bio: "Identidade falsa" }),
      /Identidade inválida/,
    );
    const followed = await profileAction("follow", {
      actor_id: viewer,
      target_id: author,
    });
    assert.equal(followed.active, true);

    const summary = (
      await db.query<{
        username: string;
        bio: string;
        post_count: number;
        achievement_count: number;
        medal_count: number;
        viewer_following: boolean;
      }>("select * from community_profile($1,$2,$3)", [
        campaign,
        viewer,
        author,
      ])
    ).rows[0];
    assert.equal(summary.username, "darkvsm");
    assert.equal(summary.bio, "Entre ruínas e recomeços.");
    assert.equal(Number(summary.post_count), 1);
    assert.equal(Number(summary.achievement_count), 2);
    assert.equal(Number(summary.medal_count), 1);
    assert.equal(summary.viewer_following, true);

    const profilePosts = await db.query<{
      id: string;
      like_count: number;
      viewer_liked: boolean;
    }>("select * from community_profile_posts($1,$2,$3,null,null,6)", [
      campaign,
      viewer,
      author,
    ]);
    assert.equal(profilePosts.rows.length, 1);
    assert.equal(Number(profilePosts.rows[0].like_count), 1);
    assert.equal(profilePosts.rows[0].viewer_liked, true);

    const collection = await db.query<{
      cosmetic_id: string;
      equipped: boolean;
    }>("select * from community_profile_collectibles($1,$2,$3)", [
      campaign,
      viewer,
      author,
    ]);
    assert.equal(collection.rows.length, 2);
    assert.equal(
      collection.rows.find((item) => item.cosmetic_id === medal)?.equipped,
      true,
    );

    await db.exec("reset role");
    const secondPost = (
      await db.query<{ id: string }>(
        "insert into community_posts(campaign_id,author_id,caption) values($1,$2,'Novo post') returning id",
        [campaign, author],
      )
    ).rows[0];
    assert.equal(
      (
        await db.query<{ reference_id: string }>(
          "select reference_id from notifications where user_id=$1",
          [viewerUser],
        )
      ).rows[0].reference_id,
      secondPost.id,
    );
  } finally {
    await db.close();
  }
});

test("community profile UI follows the dark fantasy mobile profile contract", async () => {
  const [profile, panel, styles, migrationSource] = await Promise.all([
    readFile(
      new URL("../components/CommunityProfile.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../components/CommunityPanel.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../components/CommunityProfile.module.css", import.meta.url),
      "utf8",
    ),
    migration(),
  ]);

  assert.match(profile, /<h1>\{identity\.name\}<\/h1>/);
  assert.match(profile, /`@\$\{summary\.username\}`/);
  assert.match(profile, /community_profile_action/);
  assert.match(profile, /op: "bio"/);
  assert.match(profile, /op: "follow"/);
  assert.match(profile, />Sessões</);
  assert.match(profile, /label: "Conquistas"/);
  assert.match(profile, /label: "Molduras"/);
  assert.match(profile, /label: "Medalhas"/);
  assert.match(profile, /community_profile_posts/);
  assert.match(profile, /PROFILE_PAGE_SIZE = 6/);
  assert.match(profile, /loading="lazy"/);
  assert.doesNotMatch(profile, /Compartilhar|Share/i);
  assert.doesNotMatch(profile, /orkutista-logo/);
  assert.match(panel, /<CommunityProfile/);
  assert.match(panel, /view === "profile" \? styles\.activeBottomItem/);
  assert.match(panel, /<strong>\{current\.name\}<\/strong>/);
  assert.match(styles, /community-wallpaper\.webp/);
  assert.match(styles, /grid-template-columns: repeat\(5,/);
  assert.match(styles, /@media \(max-width: 520px\)/);
  assert.match(migrationSource, /enable row level security/);
  assert.match(migrationSource, /actor\.id=target\.id/);
  assert.match(migrationSource, /follower_identity_id=actor\.id/);
  assert.match(migrationSource, /community_post_follower_notification/);
});
