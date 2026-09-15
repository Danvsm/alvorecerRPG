export type AvatarSelectionTarget =
  | { kind: "profile"; identityId: string }
  | { kind: "character"; characterId: string; identityId?: string };

export function avatarSelectionRequest(
  campaign: string,
  target: AvatarSelectionTarget,
  avatarId: string,
) {
  if (!campaign || !avatarId) throw new Error("Seleção de avatar inválida");

  if (target.kind === "character") {
    if (!target.characterId) throw new Error("Personagem inválido");
    if (!target.identityId)
      return {
        rpc: "game_action" as const,
        params: {
          c: campaign,
          op: "avatar_select",
          d: { character_id: target.characterId, avatar_id: avatarId },
        },
      };
  }

  if (!target.identityId) throw new Error("Perfil inválido");
  return {
    rpc: "identity_action" as const,
    params: {
      c: campaign,
      op: "avatar",
      d: { identity_id: target.identityId, avatar_id: avatarId },
    },
  };
}
