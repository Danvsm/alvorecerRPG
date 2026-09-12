
import { z } from "zod";
import { randomUUID } from "node:crypto";
import {
  admin,
  hash,
  originCheck,
  publicAuth,
  provision,
  throttle,
} from "./server.ts";
const schema = z.object({
  action: z.enum(["login", "invite"]),
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9_]{3,32}$/),
  password: z.string().min(6).max(72),
  token: z.string().max(128).optional(),
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
        await provision(c, d.username, d.password, { name: d.username }, claim);
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
            ? "Confira username (3 a 32 letras, números ou _) e senha (6 a 72 caracteres)."
            : (e as Error).message,
      },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
}
