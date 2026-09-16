import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  combatDamagePayload,
  combatResourceCommand,
  sortCombatParticipants,
  type CombatResourceKey,
} from "../lib/combat";

const ownCharacter = {
  id: "character-own",
  owner_id: "player",
};
const otherCharacter = {
  id: "character-other",
  owner_id: "other",
};

test("master combat adjustments reuse combat_update for every resource", () => {
  for (const resource of ["life", "mana", "stamina"] as CombatResourceKey[]) {
    assert.deepEqual(
      combatResourceCommand({
        participant: { id: "enemy", character_id: null },
        resource,
        delta: 37,
        isMaster: true,
        userId: "master",
        characters: [ownCharacter, otherCharacter],
      }),
      {
        op: "combat_update",
        data: { id: "enemy", key: resource, delta: 37 },
      },
    );
  }
});

test("player can only lose each resource on their own character", () => {
  for (const resource of ["life", "mana", "stamina"] as CombatResourceKey[]) {
    assert.deepEqual(
      combatResourceCommand({
        participant: { id: "own", character_id: ownCharacter.id },
        resource,
        delta: -12,
        isMaster: false,
        userId: "player",
        characters: [ownCharacter],
      }),
      {
        op: "resource",
        data: {
          character_id: ownCharacter.id,
          key: resource,
          delta: -12,
          reason: "Combate",
        },
      },
    );
  }

  assert.throws(
    () =>
      combatResourceCommand({
        participant: { id: "own", character_id: ownCharacter.id },
        resource: "mana",
        delta: 12,
        isMaster: false,
        userId: "player",
        characters: [ownCharacter],
      }),
    /Somente o mestre/,
  );
  assert.throws(
    () =>
      combatResourceCommand({
        participant: { id: "other", character_id: otherCharacter.id },
        resource: "stamina",
        delta: -12,
        isMaster: false,
        userId: "player",
        characters: [ownCharacter, otherCharacter],
      }),
    /próprio personagem/,
  );
});

test("combat resource adjustments reject zero and fractional values", () => {
  for (const delta of [0, 1.5]) {
    assert.throws(() =>
      combatResourceCommand({
        participant: { id: "enemy" },
        resource: "life",
        delta,
        isMaster: true,
        userId: "master",
        characters: [],
      }),
    );
  }
});

test("player damage routes an enemy participant and a positive integer amount", () => {
  assert.deepEqual(combatDamagePayload({ id: "enemy", side: "enemy" }, 17), {
    participant_id: "enemy",
    amount: 17,
  });
  assert.throws(
    () => combatDamagePayload({ id: "ally", side: "ally" }, 17),
    /inimigo/,
  );
  for (const amount of [0, -1, 1.5, 100001]) {
    assert.throws(() =>
      combatDamagePayload({ id: "enemy", side: "enemy" }, amount),
    );
  }
});

test("combat enemy cards route player damage through the protected RPC", async () => {
  const [panel, game] = await Promise.all([
    readFile(new URL("../components/CombatPanel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/Game.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(panel, /participant\.side === "enemy"/);
  assert.match(panel, /setSelectedDamageTargetId\(participant\.id\)/);
  assert.match(panel, /await onDamageEnemy\(selectedDamageTarget, amount\)/);
  assert.match(panel, /combat-participant-card is-\$\{side\}/);
  assert.match(panel, /is-hit/);
  assert.match(game, /rpc\("combat_damage"/);
  assert.match(game, /combatDamagePayload\(participant, amount\)/);
});

test("combat cards keep a stable order when damage changes their state", () => {
  const before = sortCombatParticipants([
    { id: "z-2", name: "Zumbi", life: 20, state: "green" },
    { id: "a-2", name: "Aranha", life: 15, state: "green" },
    { id: "a-1", name: "Aranha", life: 10, state: "yellow" },
  ]);
  const after = sortCombatParticipants([
    { id: "a-1", name: "Aranha", life: 2, state: "red" },
    { id: "z-2", name: "Zumbi", life: 0, state: "zero" },
    { id: "a-2", name: "Aranha", life: 8, state: "yellow" },
  ]);

  assert.deepEqual(
    before.map((participant) => participant.id),
    ["a-1", "a-2", "z-2"],
  );
  assert.deepEqual(
    after.map((participant) => participant.id),
    before.map((participant) => participant.id),
  );
});
