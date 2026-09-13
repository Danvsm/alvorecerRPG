import { z } from "zod";
import { randomUUID } from "node:crypto";
import { validBirthDate } from "./birth-date.ts";
import {
  admin,
  hash,
  originCheck,
  publicAuth,
  provision,
  throttle,
} from "./server.ts";
const schema = z
  .object({
    action: z.enum(["login", "invite"]),
    username: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9_]{3,32}$/),
    password: z.string().min(6).max(72),
    token: z.string().max(128).optional(),
    fullName: z.string().trim().max(160).optional(),
    email: z.string().trim().toLowerCase().email().max(254).optional(),
    birthDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional()
      .or(z.literal("")),
    characterName: z.string().trim().max(120).optional(),
    characterClass: z.string().trim().max(120).optional(),
    characterRace: z.string().trim().max(120).optional(),
  })
  .superRefine((value, context) => {
    if (value.action !== "invite") return;
    if (!validBirthDate(value.birthDate))
      context.addIssue({
        code: "custom",
        path: ["birthDate"],
        message: "Informe uma data de nascimento válida, não futura.",
      });
    if (!value.fullName || value.fullName.length < 3)
      context.addIssue({
        code: "custom",
        path: ["fullName"],
        message: "Nome obrigatório",
      });
    if (!value.email)
      context.addIssue({
        code: "custom",
        path: ["email"],
        message: "E-mail obrigatório",
      });
    if (!value.characterName)
      context.addIssue({
        code: "custom",
        path: ["characterName"],
        message: "Personagem obrigatório",
      });
  });
export async function POST(req: Request) {
  try {
    originCheck(req);
    const d = schema.parse(await req.json());
    await throttle(`user:${d.username}`);
    let db = admin();
    if (d.action === "invite") {
      if (!d.token) throw new Error("Convite inválido");
      await throttle(`invite:${d.token}`);
      const claim = randomUUID();
      const { data: c, error } = await db.rpc("claim_invite", {
        h: hash(d.token),
        claim,
      });
      if (error) throw new Error("Convite inválido, expirado ou em uso");
      try {
        await provision(
          c,
          d.username,
          d.password,
          {
            name: d.characterName,
            class: d.characterClass || "",
            race: d.characterRace || "",
            person: {
              full_name: d.fullName,
              email: d.email,
              birth_date: d.birthDate || "",
            },
          },
          claim,
        );
      } catch (e) {
        await db
          .from("invites")
          .update({ claim_id: null, claimed_at: null })
          .eq("claim_id", claim)
          .is("used_by", null);
        throw e;
      }
    }
    const { data: p } = await db
      .from("profiles")
      .select("id")
      .eq("username", d.username)
      .single();
    const { data: v } = p
      ? await db
          .from("credential_vault")
          .select("identity")
          .eq("user_id", p.id)
          .single()
      : { data: null };
    if (p) {
      const { data: membership } = await db
        .from("campaign_members")
        .select("user_id")
        .eq("user_id", p.id)
        .eq("access_active", true)
        .is("archived_at", null)
        .limit(1)
        .maybeSingle();
      if (!membership) throw new Error("Acesso desativado. Fale com o Mestre.");
    }
    const { data, error } = await publicAuth().auth.signInWithPassword({
      email: v?.identity || "unknown@auth.alvorecer.invalid",
      password: d.password,
    });
    if (error || !data.session) throw new Error("Username ou senha incorretos");
    return Response.json(
      {
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return Response.json(
      {
        error:
          e instanceof z.ZodError
            ? e.issues
                .map((issue) =>
                  issue.path[0] === "birthDate"
                    ? "Informe uma data de nascimento válida, não futura."
                    : issue.message,
                )
                .join(" ")
            : (e as Error).message,
      },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
}
