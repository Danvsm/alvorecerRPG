import { test } from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { orderCommunityIdentities } from "../lib/community";

test("community uses the central framed avatar and protected presence RPC", async () => {
  const source = await readFile(
    new URL("../components/CommunityPanel.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /<IdentityAvatar/);
  assert.match(source, /rpc\("community_presence"/);
  assert.match(source, /entry\.online/);
  assert.match(source, /Online agora/);
  assert.match(source, /type CommunityView/);
  assert.match(source, /view === "home"/);
  assert.match(source, /view === "explore"/);
  assert.match(source, /view === "messages"/);
  assert.match(source, /Ranking/);
});

test("presence starts immediately and keeps a dedicated heartbeat", async () => {
  const source = await readFile(
    new URL("../components/ActivityTracker.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /rpc\("presence_ping"/);
  assert.match(source, /void pingPresence\(true\)/);
  assert.match(source, /alvorecer:presence-updated/);
  assert.match(source, /30000/);
});

test("the default directory prioritizes online profiles then real wealth", () => {
  const identities = [
    { id: "poor", user_id: "user-poor", name: "Zara" },
    { id: "rich", user_id: "user-rich", name: "Bia" },
    { id: "middle", user_id: "user-middle", name: "Ana" },
    { id: "master", user_id: "user-master", name: "Pink" },
  ];
  const ranks = new Map([
    ["rich", 1],
    ["middle", 2],
    ["poor", 3],
  ]);

  assert.deepEqual(
    orderCommunityIdentities(identities, ranks, new Set(), "wealth").map(
      (identity) => identity.id,
    ),
    ["rich", "middle", "poor", "master"],
  );
  assert.deepEqual(
    orderCommunityIdentities(
      identities,
      ranks,
      new Set(["user-poor"]),
      "wealth",
    ).map((identity) => identity.id),
    ["poor", "rich", "middle", "master"],
  );
});

test("the top rail is reserved for active Stories", async () => {
  const [panel, stories] = await Promise.all([
    readFile(
      new URL("../components/CommunityPanel.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../components/CommunityStories.tsx", import.meta.url),
      "utf8",
    ),
  ]);

  assert.match(panel, /<CommunityStories/);
  assert.match(stories, /community_stories/);
  assert.match(stories, />Story</);
  assert.doesNotMatch(panel, /const featured =/);
});

test("the five supplied rank medals are part of the community gallery", async () => {
  await Promise.all(
    [1, 2, 3, 4, 5].map((rank) =>
      access(new URL(`../public/community/rank-${rank}.webp`, import.meta.url)),
    ),
  );

  const source = await readFile(
    new URL("../components/CommunityPanel.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /\/community\/rank-\$\{rank\}\.webp/);
  assert.match(source, /rank > 5/);
  assert.match(source, /<RankMedal rank=\{rank\}/);
});

test("explore ranks real profiles by wealth, sessions, achievements and medals", async () => {
  const [source, migration] = await Promise.all([
    readFile(
      new URL("../components/CommunityPanel.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL(
        "../supabase/migrations/20260920064646_community_rankings.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  ]);

  assert.match(source, /rpc\("community_rankings"/);
  assert.match(source, />\s*Riqueza\s*</);
  assert.match(source, />\s*Sessões\s*</);
  assert.match(source, />\s*Conquistas\s*</);
  assert.match(source, />\s*Medalhas\s*</);
  assert.match(source, /Posição no ranking de Dracmas/);
  assert.match(migration, /function public\.community_rankings\(c uuid\)/);
  assert.match(migration, /session_rank bigint/);
  assert.match(migration, /achievement_rank bigint/);
  assert.match(migration, /medal_rank bigint/);
  assert.match(migration, /not public\.is_member\(c\)/);
  assert.doesNotMatch(migration, /returns table\([\s\S]*?wealth_cents bigint/);
});

test("the supplied community wallpaper is optimized and used by the social header", async () => {
  await access(
    new URL("../public/community/community-wallpaper.webp", import.meta.url),
  );
  const css = await readFile(
    new URL("../components/CommunityPanel.module.css", import.meta.url),
    "utf8",
  );
  assert.match(css, /\/community\/community-wallpaper\.webp/);
});

test("community follows the Orkutista social layout without dropping existing flows", async () => {
  const [source, css] = await Promise.all([
    readFile(
      new URL("../components/CommunityPanel.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../components/CommunityPanel.module.css", import.meta.url),
      "utf8",
    ),
  ]);

  assert.doesNotMatch(source, /\/community\/orkutista-logo\.webp/);
  assert.match(source, /aria-label="Abrir menu"/);
  assert.match(source, /Pesquisar na comunidade/);
  assert.match(source, /Navegação da comunidade/);
  assert.match(source, />Início</);
  assert.match(source, />Explorar</);
  assert.match(source, />Criar</);
  assert.match(source, />Conversar</);
  assert.match(source, />Perfil</);
  assert.match(source, /onClick=\{\(\) => actor && revealProfile\(actor\)\}/);
  assert.match(source, /<CommunityProfile/);
  assert.match(source, /unreadMessages > 0/);
  assert.match(source, /styles\.messageBadge/);
  assert.doesNotMatch(source, /Seções da Comunidade/);
  assert.doesNotMatch(source, /Em destaque/);
  assert.match(source, /Ver todos/);
  assert.match(source, /<CommunityStories/);
  assert.match(css, /\.storyRing/);
  assert.match(css, /\.bottomNav/);
  assert.match(css, /position: fixed/);
  assert.match(css, /width: min\(100%, 980px\)/);
  assert.match(css, /border-top: 1px solid/);
  assert.match(css, /background: transparent/);
  assert.match(css, /\.bottomIcon\s*\{[\s\S]*?overflow: visible/);
  assert.match(css, /button > span:not\(\.bottomIcon\)/);
  assert.doesNotMatch(css, /\.bottomNav button span\s*\{/);
});

test("community moves the real unread count from the floating chat to Conversar", async () => {
  const [game, chat, community] = await Promise.all([
    readFile(new URL("../components/Game.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/DirectChat.tsx", import.meta.url), "utf8"),
    readFile(
      new URL("../components/CommunityPanel.tsx", import.meta.url),
      "utf8",
    ),
  ]);

  assert.match(game, /hideBubble=\{page === "Comunidade"\}/);
  assert.match(game, /onUnreadChange=\{setUnreadMessages\}/);
  assert.match(game, /unreadMessages=\{unreadMessages\}/);
  assert.match(chat, /rpc\("unread_messages"/);
  assert.match(chat, /onUnreadChange\?\.\(unread\)/);
  assert.match(chat, /!hideBubble/);
  assert.match(community, /mensagens não lidas/);
  assert.match(community, /unreadMessages > 99 \? "99\+"/);
});


test("master monitoring can permanently delete reports while RLS keeps players blocked", async () => {
  const [monitor, migration] = await Promise.all([
    readFile(new URL("../components/ConversationMonitor.tsx", import.meta.url), "utf8"),
    readFile(
      new URL(
        "../supabase/migrations/20260921192840_master_delete_conversation_reports.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  ]);

  assert.match(monitor, /conversation_reports/);
  assert.match(monitor, /\.delete\(\)/);
  assert.match(monitor, /monitor-report-delete/);
  assert.match(monitor, /Excluir definitivamente/);
  assert.match(monitor, /event: "DELETE"/);

  assert.match(
    migration,
    /grant delete on table public\.conversation_reports to authenticated/,
  );
  assert.match(migration, /conversation_reports_master_delete/);
  assert.match(migration, /for delete/);
  assert.match(migration, /public\.is_master\(campaign_id\)/);
});


test("chat includes an automatic campaign-wide group for active players and master", async () => {
  const [chat, migration] = await Promise.all([
    readFile(new URL("../components/DirectChat.tsx", import.meta.url), "utf8"),
    readFile(
      new URL(
        "../supabase/migrations/20260921193924_campaign_group_chat.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  ]);

  assert.match(chat, /campaign_group_summary/);
  assert.match(chat, /campaign_group_messages/);
  assert.match(chat, /campaign_group_action/);
  assert.match(chat, /Grupo Geral/);
  assert.match(chat, /chat-group-row/);
  assert.match(chat, /campaign_group_messages/);

  assert.match(migration, /create table if not exists public\.campaign_group_chats/);
  assert.match(migration, /create table if not exists public\.campaign_group_messages/);
  assert.match(migration, /identity\.kind in \('player','master'\)/);
  assert.match(migration, /identity\.active/);
  assert.match(migration, /identity\.user_id is not null/);
  assert.match(migration, /member_count/);
  assert.match(migration, /campaign_group_reads/);
  assert.match(migration, /alter publication supabase_realtime add table public\.campaign_group_messages/);
});
