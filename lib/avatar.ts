export type AvatarSelectionTarget =
  | { kind: "profile"; identityId: string }
  | { kind: "character"; characterId: string; identityId?: string };

type CharacterOwner = { owner_id?: string | null };
type SocialIdentity = {
  id?: string;
  user_id?: string | null;
  campaign_id?: string;
  kind?: string;
};

export type AvatarPolicyOperation =
  | "block"
  | "unblock"
  | "share"
  | "unshare"
  | "exclusive"
  | "clear_exclusive"
  | "archive"
  | "reactivate"
  | "disable"
  | "enable"
  | `rarity:${string}`;

export const avatarRarityLabels: Record<string, string> = {
  common: "Comum",
  uncommon: "Incomum",
  rare: "Rara",
  epic: "Épica",
  legendary: "Lendária",
  event: "Evento",
  supporter: "Apoiador",
  master: "Mestre",
};

export const avatarStateLabels: Record<string, string> = {
  available: "Disponível",
  in_use: "Em uso",
  blocked: "Bloqueado",
  exclusive: "Exclusivo",
  shared: "Compartilhável",
  archived: "Arquivado",
  disabled: "Desativado",
};

export function avatarSelectableFor(
  avatar: {
    id?: string;
    active?: boolean;
    blocked?: boolean;
    shared?: boolean;
    exclusive_user_id?: string | null;
    usage?: Array<{ user_id?: string }>;
    occupied_by_other?: boolean;
    archived_at?: string | null;
    chest_only?: boolean;
    owned?: boolean;
  },
  targetUserId?: string | null,
  targetIsMaster = false,
  selectedId?: string | null,
) {
  if (avatar.id === selectedId) return true;
  if (!avatar.active) return false;
  if (targetIsMaster || !targetUserId) return true;
  if (avatar.blocked) return false;
  if ((avatar.archived_at || avatar.chest_only) && !avatar.owned) return false;
  if (avatar.exclusive_user_id && avatar.exclusive_user_id !== targetUserId)
    return false;
  if (avatar.shared) return true;
  if (avatar.occupied_by_other) return false;
  return !(avatar.usage || []).some(
    (entry) => entry.user_id && entry.user_id !== targetUserId,
  );
}

export function characterAvatarIdentityId(
  campaign: string,
  character: CharacterOwner | undefined,
  identities: SocialIdentity[],
) {
  const ownerId = character?.owner_id;
  if (!ownerId) return undefined;

  return identities.find(
    (identity) =>
      identity.user_id === ownerId &&
      identity.campaign_id === campaign &&
      identity.kind === "player",
  )?.id;
}

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
