import { test } from "node:test";
import assert from "node:assert/strict";
import { combatLifeCommand } from "../lib/combat";

const ownCharacter = {
  id: "character-own",
  owner_id: "player",
};
const otherCharacter = {
  id: "character-other",
  owner_id: "other",
};

test("master combat Life adjustments reuse combat_update for any participant", () => {
  assert.deepEqual(
    combatLifeCommand({
      participant: { id: "enemy", character_id: null },
      delta: 37,
      isMaster: true,
      userId: "master",
      characters: [ownCharacter, otherCharacter],
    }),
    {
      op: "combat_update",
      data: { id: "enemy", key: "life", delta: 37 },
    },
  );
});

test("player can only lose Life on their own character", () => {
  assert.deepEqual(
    combatLifeCommand({
      participant: { id: "own", character_id: ownCharacter.id },
      delta: -12,
      isMaster: false,
      userId: "player",
      characters: [ownCharacter],
    }),
    {
      op: "resource",
      data: {
        character_id: ownCharacter.id,
        key: "life",
        delta: -12,
        reason: "Combate",
      },
    },
  );

  assert.throws(
    () =>
      combatLifeCommand({
        participant: { id: "own", character_id: ownCharacter.id },
        delta: 12,
        isMaster: false,
        userId: "player",
        characters: [ownCharacter],
      }),
    /Somente o mestre/,
  );
  assert.throws(
    () =>
      combatLifeCommand({
        participant: { id: "other", character_id: otherCharacter.id },
        delta: -12,
        isMaster: false,
        userId: "player",
        characters: [ownCharacter, otherCharacter],
      }),
    /próprio personagem/,
  );
});

test("combat Life adjustments reject zero and fractional values", () => {
  for (const delta of [0, 1.5]) {
    assert.throws(() =>
      combatLifeCommand({
        participant: { id: "enemy" },
        delta,
        isMaster: true,
        userId: "master",
        characters: [],
      }),
    );
  }
});
