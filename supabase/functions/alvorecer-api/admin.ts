
import { z } from "zod";
import { randomBytes } from "node:crypto";
import { credential, hash, master, originCheck, provision } from "./server.ts";
import { encrypt, generatePassword } from "./crypto.ts";
const base = z.object({
  action: z.enum([
    "create",
    "show",
    "password",
    "generate",
    "invite",
    "cancel_invite",
  ]),
  campaign: z.string().uuid(),
  userId: z.string().uuid().optional(),
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9_]{3,32}$/)
    .optional(),
  password: z.string().min(6).max(72).optional(),
  character: z.record(z.unknown()).optional(),
  hours: z.number().int().min(1).max(720).optional(),
  inviteId: z.string().uuid().optional(),
});
export async function POST(req: Request) {
  try {
    originCheck(req);
    const d = base.parse(await req.json());
    const { db, user } = await master(req, d.campaign);
    let result: object = {};
    if (d.action === "create") {
      if (!d.username || !d.password)
        throw new Error("Preencha username e senha");
      result = {
        character: await provision(
          d.campaign,
          d.username,
          d.password,
          d.character || {},
          undefined,
          user.id,
        ),
      };
    }
    if (d.action === "generate") result = { password: generatePassword() };
    if (d.action === "show" || d.action === "password") {
      if (!d.userId) throw new Error("Jogador inválido");
      await credential(d.campaign, d.userId);
      if (d.action === "password") {
        if (!d.password) throw new Error("Informe a senha");
        const cipher = encrypt(d.password, d.userId);
        const lock = await db.rpc("lock_credential", { u: d.userId, cipher });
        if (lock.error) throw new Error(lock.error.message);
        const change = await db.auth.admin.updateUserById(d.userId, {
          password: d.password,
        });
        if (change.error)
          throw new Error(
            "Alteração pendente. Consulte a senha após um minuto para reconciliar.",
          );
        const done = await db.rpc("finish_credential", {
          u: d.userId,
          expected: cipher,
          success: true,
        });
        if (done.error)
          throw new Error(
            "Senha alterada; confirmação pendente. Consulte após um minuto.",
          );
      }
      const log = await db.from("audit_logs").insert({
        campaign_id: d.campaign,
        actor_id: user.id,
        action: d.action === "show" ? "credential_view" : "credential_change",
        detail: { user_id: d.userId },
      });
      if (log.error) throw new Error("Não foi possível registrar a operação");
      if (d.action === "show")
        result = {
          password: (await credential(d.campaign, d.userId)).password,
        };
    }
    if (d.action === "invite") {
      const token = randomBytes(32).toString("hex");
      const { error } = await db.from("invites").insert({
        campaign_id: d.campaign,
        token_hash: hash(token),
        expires_at: new Date(
          Date.now() + (d.hours || 24) * 3600000,
        ).toISOString(),
      });
      if (error) throw new Error("Não foi possível criar convite");
      result = { url: `/convite/${token}` };
    }
    if (d.action === "cancel_invite") {
      const { error } = await db
        .from("invites")
        .update({ cancelled: true })
        .eq("id", d.inviteId!)
        .eq("campaign_id", d.campaign)
        .is("used_by", null);
      if (error) throw new Error("Não foi possível cancelar");
    }
    return Response.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    return Response.json(
      {
        error:
          e instanceof z.ZodError
            ? "Confira os campos do formulário"
            : (e as Error).message,
      },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
}
