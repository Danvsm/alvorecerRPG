import { createHash } from "node:crypto";
import { z } from "zod";

export const runtime = "nodejs";

const schema = z.object({
  fullName: z.string().trim().min(3).max(120),
  preferredName: z.string().trim().min(2).max(80),
  age: z.coerce.number().int().min(1).max(120),
  email: z.string().trim().email().max(254),
  whatsapp: z.string().trim().min(8).max(32),
  instagram: z.string().trim().max(80).optional().default(""),
  city: z.string().trim().min(2).max(100),
  neighborhood: z.string().trim().min(2).max(100),
  experienceLevel: z.enum([
    "iniciante",
    "algumas_vezes",
    "intermediario",
    "experiente",
  ]),
  availability: z.string().trim().min(2).max(200),
  preferredTime: z.string().trim().min(2).max(120),
  expectations: z.string().trim().min(3).max(1500),
  avoidedContent: z.string().trim().max(1500).optional().default(""),
  discoverySource: z.string().trim().min(2).max(120),
  contactConsent: z.literal(true),
  website: z.string().max(200).optional().default(""),
});

function sameOrigin(req: Request) {
  const origin = req.headers.get("origin");
  if (!origin) return false;

  const allowed = [
    process.env.APP_ORIGIN,
    process.env.VERCEL_URL && "https://" + process.env.VERCEL_URL,
    process.env.VERCEL_PROJECT_PRODUCTION_URL &&
      "https://" + process.env.VERCEL_PROJECT_PRODUCTION_URL,
    process.env.NODE_ENV !== "production" && "http://localhost:3000",
  ]
    .filter((value): value is string => Boolean(value))
    .map((value) => {
      try {
        return new URL(value).origin;
      } catch {
        return "";
      }
    });

  return allowed.includes(origin);
}

function publicMessage(message: unknown) {
  const value = String(message || "");
  const allowed = [
    "Informe seu nome e sobrenome.",
    "Informe como gostaria de ser chamado.",
    "Informe uma idade válida.",
    "Informe um e-mail válido.",
    "Informe um WhatsApp válido.",
    "O Instagram ficou muito longo.",
    "Informe sua cidade ou município.",
    "Informe seu bairro.",
    "Selecione sua experiência com RPG.",
    "Informe sua disponibilidade.",
    "Informe sua preferência de horário.",
    "Conte o que espera de uma mesa de RPG.",
    "O campo de conteúdo ficou muito longo.",
    "Informe como conheceu o projeto.",
    "Autorize o contato para concluir.",
    "Muitas tentativas. Aguarde alguns minutos.",
  ];
  return allowed.includes(value)
    ? value
    : "Não foi possível enviar agora. Tente novamente.";
}

export async function POST(req: Request) {
  try {
    if (!sameOrigin(req)) {
      return Response.json({ error: "Origem não permitida." }, { status: 403 });
    }

    const raw = await req.text();
    if (raw.length > 16000) {
      return Response.json({ error: "Pedido muito grande." }, { status: 413 });
    }

    let parsedBody: unknown;
    try {
      parsedBody = JSON.parse(raw);
    } catch {
      return Response.json({ error: "Dados inválidos." }, { status: 400 });
    }

    const parsed = schema.safeParse(parsedBody);
    if (!parsed.success) {
      return Response.json(
        { error: "Revise os campos antes de enviar." },
        { status: 400 },
      );
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) {
      return Response.json(
        { error: "Inscrições temporariamente indisponíveis." },
        { status: 503 },
      );
    }

    const forwarded =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("x-real-ip")?.trim() ||
      "unknown";
    const rateKey = createHash("sha256")
      .update("alvorecer-recruitment-v1|" + forwarded)
      .digest("hex");

    const response = await fetch(
      url + "/rest/v1/rpc/submit_recruitment_application",
      {
        method: "POST",
        headers: {
          apikey: key,
          Authorization: "Bearer " + key,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          p_full_name: parsed.data.fullName,
          p_preferred_name: parsed.data.preferredName,
          p_age: parsed.data.age,
          p_email: parsed.data.email,
          p_whatsapp: parsed.data.whatsapp,
          p_instagram: parsed.data.instagram || null,
          p_city: parsed.data.city,
          p_neighborhood: parsed.data.neighborhood,
          p_experience_level: parsed.data.experienceLevel,
          p_availability: parsed.data.availability,
          p_preferred_time: parsed.data.preferredTime,
          p_expectations: parsed.data.expectations,
          p_avoided_content: parsed.data.avoidedContent || null,
          p_discovery_source: parsed.data.discoverySource,
          p_contact_consent: parsed.data.contactConsent,
          p_rate_key: rateKey,
          p_website: parsed.data.website,
        }),
        cache: "no-store",
        signal: AbortSignal.timeout(12000),
      },
    );

    if (!response.ok) {
      let message = "";
      try {
        const payload = await response.json();
        message = payload?.message || payload?.error || "";
      } catch {}
      return Response.json(
        { error: publicMessage(message) },
        { status: response.status >= 500 ? 502 : 400 },
      );
    }

    return Response.json(
      { ok: true },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch {
    return Response.json(
      { error: "Não foi possível enviar agora. Tente novamente." },
      { status: 502 },
    );
  }
}
