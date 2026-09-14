import type { Row } from "./types";

export type CombatCommand = {
  op: "combat_update" | "resource";
  data: Row;
};

export function combatLifeCommand({
  participant,
  delta,
  isMaster,
  userId,
  characters,
}: {
  participant: Row;
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
      data: { id: participant.id, key: "life", delta },
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
    throw new Error("Somente o mestre pode recuperar Vida manualmente");
  }

  return {
    op: "resource",
    data: {
      character_id: participant.character_id,
      key: "life",
      delta,
      reason: "Combate",
    },
  };
}
