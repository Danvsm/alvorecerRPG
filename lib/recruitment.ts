export const RECRUITMENT_CAMPAIGN = "A Promessa do Amanhecer";

// Centralized public contact; Vercel can override this URL when needed.
export const TABLE_CONTACT_URL =
  process.env.NEXT_PUBLIC_TABLE_CONTACT_URL?.trim() ||
  "https://wa.me/5521993152560?text=Ol%C3%A1%2C%20eu%20fiquei%20interessado%20no%20Rpg";

export const recruitmentStatuses = [
  ["new", "Nova"],
  ["reviewing", "Em análise"],
  ["contacted", "Contatado"],
  ["approved", "Aprovado"],
  ["waitlist", "Lista de espera"],
  ["not_selected", "Não selecionado"],
] as const;

export type RecruitmentStatus = (typeof recruitmentStatuses)[number][0];

export const recruitmentStatusLabel = Object.fromEntries(
  recruitmentStatuses,
) as Record<RecruitmentStatus, string>;
