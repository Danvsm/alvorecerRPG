export const RECRUITMENT_CAMPAIGN = "A Promessa do Amanhecer";

// Configure this once in Vercel when the public WhatsApp/contact link is ready.
export const TABLE_CONTACT_URL =
  process.env.NEXT_PUBLIC_TABLE_CONTACT_URL?.trim() || "";

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
