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
  assert.match(source, /Descobrir/);
  assert.match(source, /Mensagens/);
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
  await access(
    new URL("../public/community/orkutista-logo.webp", import.meta.url),
  );
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

  assert.match(source, /\/community\/orkutista-logo\.webp/);
  assert.match(source, /aria-label="Abrir menu"/);
  assert.match(source, /Pesquisar na comunidade/);
  assert.match(source, /Navegação da comunidade/);
  assert.match(source, />Início</);
  assert.match(source, />Explorar</);
  assert.match(source, />Criar</);
  assert.match(source, />Conversar</);
  assert.match(source, />Perfil</);
  assert.match(source, /size="clamp\(104px, 23vw, 118px\)"/);
  assert.match(css, /\.bottomNav/);
  assert.match(css, /position: fixed/);
});
