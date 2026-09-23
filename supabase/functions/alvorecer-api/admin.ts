import { z } from "zod";
import { randomBytes } from "node:crypto";
import {
  changeCredential,
  credential,
  hash,
  member,
  master,
  originCheck,
  provision,
  publicAuth,
} from "./server.ts";
import { generatePassword } from "./crypto.ts";

const avatarPolicyOperation = z.union([
  z.enum([
    "block",
    "unblock",
    "share",
    "unshare",
    "exclusive",
    "clear_exclusive",
    "archive",
    "reactivate",
    "disable",
    "enable",
  ]),
  z.string().regex(
    /^rarity:(common|uncommon|rare|epic|legendary|event|supporter|master)$/,
  ),
]);

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
    "disable_player",
    "enable_player",
    "delete_player",
    "delete_invite",
    "delete_world_character",
    "avatar_policy",
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
  deleteCharacters: z.boolean().optional(),
  confirmation: z.string().max(20).optional(),
  identityId: z.string().uuid().optional(),
  avatarOperation: avatarPolicyOperation.optional(),
  exclusiveUserId: z.string().uuid().nullable().optional(),
});
export async function POST(req: Request) {
  try {
    originCheck(req);
    const d = base.parse(await req.json());
    const context =
      d.action === "self_password"
        ? await member(req, d.campaign)
        : await master(req, d.campaign);
    const { db, user } = context;
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
    if (d.action === "disable_player" || d.action === "enable_player") {
      if (!d.userId || d.userId === user.id)
        throw new Error("Jogador inválido");
      const { data: target } = await db
        .from("campaign_members")
        .select("user_id,role")
        .eq("campaign_id", d.campaign)
        .eq("user_id", d.userId)
        .single();
      if (target?.role !== "player") throw new Error("Jogador não encontrado");
      const enabled = d.action === "enable_player";
      const authUpdate = await db.auth.admin.updateUserById(d.userId, {
        ban_duration: enabled ? "none" : "876000h",
      });
      if (authUpdate.error)
        throw new Error("Não foi possível alterar o acesso");
      const update = await db
        .from("campaign_members")
        .update({
          access_active: enabled,
          disabled_at: enabled ? null : new Date().toISOString(),
          archived_at: enabled ? null : new Date().toISOString(),
        })
        .eq("campaign_id", d.campaign)
        .eq("user_id", d.userId);
      if (update.error)
        throw new Error(
          "Acesso alterado no login, mas a campanha precisa de reparo",
        );
      const event = await db.rpc("record_event", {
        c: d.campaign,
        ch: null,
        action: enabled ? "player_enabled" : "player_disabled",
        detail: { user_id: d.userId },
        actor: user.id,
      });
      if (event.error)
        throw new Error("Acesso alterado, mas o histórico ficou pendente");
    }
    if (d.action === "delete_player") {
      if (!d.userId || d.userId === user.id)
        throw new Error("Jogador inválido");
      if (d.confirmation !== "EXCLUIR")
        throw new Error("Digite EXCLUIR para confirmar");
      const prepared = await db.rpc("prepare_delete_player", {
        c: d.campaign,
        target_user: d.userId,
        remove_characters: Boolean(d.deleteCharacters),
        actor: user.id,
      });
      if (prepared.error) throw new Error(prepared.error.message);
      const deleted = await db.auth.admin.deleteUser(d.userId);
      if (deleted.error)
        throw new Error(
          "A conta foi desativada, mas a exclusão do login ficou pendente",
        );
      if (d.deleteCharacters) {
        for (const character of prepared.data?.characters || []) {
          const removal = await db
            .from("characters")
            .delete()
            .eq("id", character.id);
          if (removal.error)
            throw new Error(
              "A conta foi excluída, mas um personagem foi preservado por segurança",
            );
          await db.rpc("record_event", {
            c: d.campaign,
            ch: null,
            action: "character_deleted",
            detail: { id: character.id, name: character.name },
            actor: user.id,
          });
        }
      }
      result = { deleted: true, ...prepared.data };
    }
    if (d.action === "delete_world_character") {
      if (!d.identityId) throw new Error("Personagem do mundo inválido");
      const removedPaths = new Set<string>();
      let deletion: Record<string, unknown> | null = null;
      for (let attempt = 0; attempt < 3 && !deletion; attempt += 1) {
        const prepared = await db.rpc("prepare_delete_world_character", {
          c: d.campaign,
          target_id: d.identityId,
          actor: user.id,
        });
        if (prepared.error) throw new Error(prepared.error.message);
        const storagePaths = Array.isArray(prepared.data?.storage_paths)
          ? prepared.data.storage_paths.filter(
              (path: unknown): path is string => typeof path === "string",
            )
          : [];
        const pendingPaths = storagePaths.filter(
          (path: string) => !removedPaths.has(path),
        );
        if (pendingPaths.length) {
          const removed = await db.storage
            .from("chat-media")
            .remove(pendingPaths);
          if (removed.error)
            throw new Error("Não foi possível remover as mídias vinculadas");
          pendingPaths.forEach((path: string) => removedPaths.add(path));
        }
        const finalized = await db.rpc("finalize_delete_world_character", {
          c: d.campaign,
          target_id: d.identityId,
          actor: user.id,
          removed_paths: [...removedPaths],
        });
        if (finalized.error) throw new Error(finalized.error.message);
        if (finalized.data?.deleted) deletion = finalized.data;
      }
      if (!deletion)
        throw new Error(
          "A conversa recebeu novas mídias durante a exclusão. Tente novamente.",
        );
      result = deletion;
    }
    if (d.action === "avatar_policy") {
      if (!d.avatarId || !d.avatarOperation)
        throw new Error("Operação de avatar inválida");
      const changed = await db.rpc("admin_avatar_action", {
        c: d.campaign,
        target_id: d.avatarId,
        actor: user.id,
        operation: d.avatarOperation,
        exclusive_user: d.exclusiveUserId || null,
      });
      if (changed.error) throw new Error(changed.error.message);
      result = changed.data;
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
      const { count, error: usageError } = await db
        .from("characters")
        .select("id", { count: "exact", head: true })
        .eq("avatar_id", avatar.id);
      if (usageError) throw new Error("Não foi possível verificar o uso do avatar");
      const identityUsage = await db.from("social_identities")
        .select("id", { count: "exact", head: true }).eq("avatar_id", avatar.id);
      if (identityUsage.error) throw new Error("Não foi possível verificar os perfis vinculados");
      if (count || identityUsage.count)
        throw new Error("Troque o avatar dos personagens antes de excluí-lo");
      const deleted = await db
        .from("campaign_avatars")
        .delete()
        .eq("id", avatar.id);
      if (deleted.error)
        throw new Error("Não foi possível excluir o cadastro do avatar");
      const removed = await db.storage.from("portraits").remove([avatar.storage_path]);
      if (removed.error) throw new Error("Cadastro excluído. A limpeza do arquivo ficou pendente");
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
    if (d.action === "delete_invite") {
      if (!d.inviteId || d.confirmation !== "EXCLUIR")
        throw new Error("Confirmação inválida");
      const { data: invite, error: inviteError } = await db
        .from("invites")
        .select("id,cancelled,expires_at,used_by")
        .eq("id", d.inviteId)
        .eq("campaign_id", d.campaign)
        .single();
      if (
        inviteError ||
        !invite ||
        invite.used_by ||
        (!invite.cancelled && Date.parse(invite.expires_at) >= Date.now())
      )
        throw new Error("Este convite não está disponível para limpeza");
      const deleted = await db.from("invites").delete().eq("id", invite.id);
      if (deleted.error) throw new Error("Não foi possível excluir o convite");
      await db.rpc("record_event", {
        c: d.campaign,
        ch: null,
        action: "invite_deleted",
        detail: { id: invite.id },
        actor: user.id,
      });
      result = { deleted: true };
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
