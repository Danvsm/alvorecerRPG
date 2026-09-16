import type { Row } from "./types";

export type CombatCommand = {
  op: "combat_update" | "resource";
  data: Row;
};

export const combatResourceKeys = ["life", "mana", "stamina"] as const;

export type CombatResourceKey = (typeof combatResourceKeys)[number];

export function combatResourceCommand({
  participant,
  resource,
  delta,
  isMaster,
  userId,
  characters,
}: {
  participant: Row;
  resource: CombatResourceKey;
  delta: number;
  isMaster: boolean;
  userId: string;
  characters: Row[];
}): CombatCommand {
  if (!Number.isInteger(delta) || delta === 0) {
    throw new Error("Informe uma quantidade inteira maior que zero");
  }

  if (isMaster) {
    return {
      op: "combat_update",
      data: { id: participant.id, key: resource, delta },
    };
  }

  const ownsCharacter = characters.some(
    (character) =>
      character.id === participant.character_id &&
      character.owner_id === userId,
  );
  if (!ownsCharacter) {
    throw new Error("Você só pode ajustar o próprio personagem");
  }
  if (delta > 0) {
    throw new Error("Somente o mestre pode recuperar recursos manualmente");
  }

  return {
    op: "resource",
    data: {
      character_id: participant.character_id,
      key: resource,
      delta,
      reason: "Combate",
    },
  };
}
