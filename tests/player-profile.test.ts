import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("player profile follows the fantasy mockup and keeps real cosmetic actions", async () => {
  const [profile, game, css] = await Promise.all([
    readFile(new URL("../components/PlayerProfilePanel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/Game.tsx", import.meta.url), "utf8"),
    readFile(
      new URL("../components/PlayerProfilePanel.module.css", import.meta.url),
      "utf8",
    ),
  ]);

  assert.match(profile, /AVENTUREIRO DO ALVORECER/);
  assert.match(profile, /Trocar avatar/);
  assert.match(profile, /Abrir carteira/);
  assert.match(profile, /Alterar senha/);
  assert.match(profile, /Sair da conta/);
  assert.match(profile, /Ver todas/);
  assert.match(profile, /Todas as molduras/);
  assert.match(profile, /Usar sem moldura/);
  assert.match(profile, /"equip"/);
  assert.match(profile, /"unequip"/);
  assert.match(profile, /"cosmetic_equip"/);
  assert.match(profile, /character\?\.name \|\| username/);
  assert.match(profile, /feed-composer-divider\.webp/);
  assert.match(game, /<PlayerProfilePanel/);
  assert.match(game, /!isMaster && page === "Perfil"/);
  assert.match(css, /overflow: visible/);
  assert.match(css, /grid-template-columns: repeat\(5/);
});

test("secret locked frames do not reveal their artwork", async () => {
  const profile = await readFile(
    new URL("../components/PlayerProfilePanel.tsx", import.meta.url),
    "utf8",
  );

  assert.match(profile, /frame\.secret && !owned/);
  assert.match(profile, /"\?\?\?"/);
  assert.match(profile, /<Lock aria-hidden="true" \/>/);
});
