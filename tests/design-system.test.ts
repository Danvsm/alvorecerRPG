import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (file: string) =>
  readFile(new URL(`../${file}`, import.meta.url), "utf8");

test("shared design finish preserves isolated screens and reduced motion", async () => {
  const [layout, css] = await Promise.all([
    read("app/layout.tsx"),
    read("app/design-system.css"),
  ]);
  assert.match(layout, /import "\.\/design-system.css"/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /hover: hover/);
  assert.match(css, /pointer: fine/);
  assert.match(css, /:not\(\.community-content\)/);
  assert.match(css, /:not\(\.combat-content\)/);
  assert.match(css, /focus-visible/);
  assert.match(css, /min-height: 44px/);
});

test("recruitment navigation and form retain accessible orientation", async () => {
  const [landing, css, game] = await Promise.all([
    read("app/jogar/JogarLanding.tsx"),
    read("app/jogar/jogar.module.css"),
    read("components/Game.tsx"),
  ]);
  assert.match(landing, /aria-label="Conheça a campanha"/);
  assert.match(landing, /ref=\{formHeading\}/);
  assert.match(landing, /focus\(\{ preventScroll: true \}\)/);
  assert.match(css, /scroll-margin-top/);
  assert.match(css, /color-scheme: light/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(game, /aria-current=\{page === name/);
  assert.match(game, /aria-expanded=\{menu\}/);
});
