import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = (path: string) =>
  readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("avatar frame stays reusable, proportional and motion-safe", async () => {
  const [component, styles] = await Promise.all([
    source("components/AvatarFrame.tsx"),
    source("app/globals.css"),
  ]);
  assert.match(component, /size\?: number \| string/);
  assert.match(component, /frame\.effects\s*\.slice\(0, 2\)/);
  assert.match(component, /clamp\(effect\.quantity, 1, 12, 6\)/);
  assert.match(styles, /--avatar-frame-size/);
  assert.match(styles, /object-fit: contain/);
  assert.match(styles, /prefers-reduced-motion: reduce/);
  assert.match(styles, /animation: none !important/);
});

test("frame editor exposes upload, preview, positioning and secret state", async () => {
  const panel = await source("components/CosmeticsPanel.tsx");
  assert.match(panel, /accept="image\/png,image\/webp"/);
  assert.match(panel, /Posição X/);
  assert.match(panel, /Posição Y/);
  assert.match(panel, /Escala:/);
  assert.match(panel, /Secreta/);
  assert.match(panel, /Testar em Pink/);
  assert.match(panel, /identity_ids: recipients/);
  assert.match(panel, /frame\.secret && !owned/);
});

test("frame and legacy cosmetic buttons dispatch distinct operations", async () => {
  const panel = await source("components/CosmeticsPanel.tsx");
  assert.match(
    panel,
    /run\(\s*"equip",\s*\{ identity_id: identity\?\.id, frame_id: chosen\?\.id \}/,
  );
  assert.match(
    panel,
    /run\("cosmetic_equip", \{\s*identity_id: identity\?\.id,\s*cosmetic_id: item\.id/,
  );
  assert.doesNotMatch(panel, /void execute\(/);
});

test("frame deletion warns about owners and removes the storage asset", async () => {
  const panel = await source("components/CosmeticsPanel.tsx");
  assert.match(panel, /Esta moldura pertence a/);
  assert.match(panel, /<strong>Donos:<\/strong>/);
  assert.match(panel, /<strong>Usando agora:<\/strong>/);
  assert.match(panel, /Excluir mesmo assim/);
  assert.match(panel, /await removeAsset\(result\.asset_path\)/);
  assert.doesNotMatch(panel, /disabled=\{busy \|\| owners\.length > 0\}/);
});
