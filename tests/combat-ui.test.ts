import { test } from "node:test";
import assert from "node:assert/strict";
import { combatResourceCommand, type CombatResourceKey } from "../lib/combat";

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
