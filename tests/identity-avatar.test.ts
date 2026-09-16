import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { equippedFrameForIdentity } from "../lib/identity-visual";

const source = (path: string) =>
  readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("equipped frame is resolved only from the identity real equipment", () => {
  const cosmetics = [
    { id: "title", kind: "title" },
    { id: "frame-a", kind: "frame", asset_path: "a.webp" },
    { id: "frame-b", kind: "frame", asset_path: "b.webp" },
  ];
  const equipment = [
    { identity_id: "other", kind: "frame", cosmetic_id: "frame-b" },
    { identity_id: "player", kind: "title", cosmetic_id: "title" },
    { identity_id: "player", kind: "frame", cosmetic_id: "frame-a" },
  ];

  assert.equal(
    equippedFrameForIdentity("player", cosmetics, equipment)?.id,
    "frame-a",
  );
  assert.equal(
    equippedFrameForIdentity("missing", cosmetics, equipment),
    undefined,
  );
});

test("global identity renderers use the central framed avatar component", async () => {
  const files = await Promise.all(
    [
      "components/IdentityBadge.tsx",
      "components/CharacterSheet.tsx",
      "components/WalletPanel.tsx",
      "components/DirectChat.tsx",
      "components/ProfileWall.tsx",
      "components/Game.tsx",
    ].map(source),
  );
  for (const file of files) assert.match(file, /<IdentityAvatar/);

  const central = await source("components/IdentityAvatar.tsx");
  assert.match(central, /equippedFrameForIdentity/);
  assert.match(central, /<AvatarFrame/);
  assert.match(central, /frameUrl=/);
});
