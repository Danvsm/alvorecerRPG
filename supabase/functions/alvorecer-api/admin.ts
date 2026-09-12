import { z } from "zod";
import { randomBytes } from "node:crypto";
import {
  changeCredential,
  credential,
  hash,
  master,
  originCheck,
  provision,
  publicAuth,
} from "./server.ts";
import { generatePassword } from "./crypto.ts";
const base = z.object({
  action: z.enum([
    "create",
    "show",
    "password",
    "generate",
    "invite",
    "cancel_invite",
    "self_password",
    "delete_avatar",
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
  currentPassword: z.string().min(6).max(72).optional(),
  character: z.record(z.unknown()).optional(),
  hours: z.number().int().min(1).max(720).optional(),
  inviteId: z.string().uuid().optional(),
  avatarId: z.string().uuid().optional(),
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
        await changeCredential(db, d.userId, d.password);
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
    if (d.action === "self_password") {
      if (!d.password || !d.currentPassword)
        throw new Error("Informe a senha atual e a nova senha");
      const current = await credential(d.campaign, user.id, false);
      const probe = publicAuth();
      const verified = await probe.auth.signInWithPassword({
        email: current.identity,
        password: d.currentPassword,
      });
      if (verified.error) throw new Error("Senha atual incorreta");
      if (verified.data.session) await probe.auth.signOut();
      await changeCredential(db, user.id, d.password);
      const log = await db.from("audit_logs").insert({
        campaign_id: d.campaign,
        actor_id: user.id,
        action: "self_password_change",
        detail: {},
      });
      if (log.error)
        throw new Error("Senha alterada, mas o histórico ficou pendente");
    }
    if (d.action === "delete_avatar") {
      if (!d.avatarId) throw new Error("Avatar inválido");
      const { data: avatar, error: avatarError } = await db
        .from("campaign_avatars")
        .select("id,storage_path")
        .eq("id", d.avatarId)
        .eq("campaign_id", d.campaign)
        .single();
      if (avatarError || !avatar) throw new Error("Avatar não encontrado");
      const { count } = await db
        .from("characters")
        .select("id", { count: "exact", head: true })
        .eq("avatar_id", avatar.id);
      if (count)
        throw new Error("Troque o avatar dos personagens antes de excluí-lo");
      const removed = await db.storage
        .from("portraits")
        .remove([avatar.storage_path]);
      if (removed.error) throw new Error("Não foi possível excluir a imagem");
      const deleted = await db
        .from("campaign_avatars")
        .delete()
        .eq("id", avatar.id);
      if (deleted.error)
        throw new Error("Não foi possível excluir o cadastro do avatar");
      const event = await db.rpc("record_event", {
        c: d.campaign,
        ch: null,
        action: "avatar_delete",
        detail: { avatar_id: avatar.id },
        actor: user.id,
      });
      if (event.error)
        throw new Error("Avatar excluído, mas o histórico ficou pendente");
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
