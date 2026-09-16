import type { Row } from "./types";

export type CombatCommand = {
  op: "combat_update" | "resource";
  data: Row;
};

export const combatResourceKeys = ["life", "mana", "stamina"] as const;

export type CombatResourceKey = (typeof combatResourceKeys)[number];

export function combatDamagePayload(participant: Row, amount: number): Row {
  if (participant.side !== "enemy") {
    throw new Error("Selecione um inimigo");
  }
  if (!Number.isInteger(amount) || amount < 1 || amount > 100000) {
    throw new Error("Informe uma quantidade inteira entre 1 e 100000");
  }
  return { participant_id: participant.id, amount };
}

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
