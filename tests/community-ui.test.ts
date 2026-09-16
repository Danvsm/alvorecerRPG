import { test } from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";

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
