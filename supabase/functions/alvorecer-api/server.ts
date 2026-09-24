import { createClient } from "@supabase/supabase-js";
import { createHash, randomUUID } from "node:crypto";
import { encrypt, decrypt } from "./crypto.ts";
import { validBirthDate } from "./birth-date.ts";
export function admin() {
  const url = Deno.env.get("SUPABASE_URL"),
    key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("Supabase ainda não configurado.");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) =>
        fetch(input, { ...init, signal: AbortSignal.timeout(15000) }),
    },
  });
}
export function publicAuth() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        fetch: (input, init) =>
          fetch(input, { ...init, signal: AbortSignal.timeout(15000) }),
      },
    },
  );
}
export function originCheck(req: Request) {
  const origin = req.headers.get("origin");
  if (origin && origin !== Deno.env.get("APP_ORIGIN"))
    throw new Error("Origem não permitida");
}
export async function member(req: Request, campaignId: string) {
  const db = admin(),
    token = req.headers.get("authorization")?.replace(/^Bearer /, "");
  if (!token) throw new Error("Entre novamente");
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) throw new Error("Entre novamente");
  const { data: m } = await db
    .from("campaign_members")
    .select("role,access_active,archived_at")
    .eq("campaign_id", campaignId)
    .eq("user_id", data.user.id)
    .single();
  if (!m || !m.access_active || m.archived_at)
    throw new Error("Acesso à campanha desativado");
  return { db, user: data.user, membership: m };
}
export async function master(req: Request, campaignId: string) {
  const context = await member(req, campaignId);
  if (context.membership.role !== "master") throw new Error("Somente o mestre");
  return context;
}
export const hash = (s: string) => createHash("sha256").update(s).digest("hex");
export async function throttle(key: string, max = 10) {
  const { data, error } = await admin().rpc("throttle", {
    k: hash(key),
    max_attempts: max,
  });
  if (error || !data) throw new Error("Muitas tentativas. Aguarde 15 minutos.");
}
export async function provision(
  campaign: string,
  username: string,
  password: string,
  character: object,
  claim?: string,
  actor?: string,
) {
  const person = (character as { person?: { birth_date?: unknown } }).person;
  if (!validBirthDate(person?.birth_date))
    throw new Error("Informe uma data de nascimento válida, não futura.");
  const db = admin(),
    identity = `${randomUUID()}@auth.alvorecer.invalid`;
  const reserve = await db.rpc("reserve_auth_identity", { identity });
  if (reserve.error) throw new Error("Não foi possível preparar a conta");
  const { data, error } = await db.auth.admin.createUser({
    email: identity,
    password,
    email_confirm: true,
    app_metadata: { alvorecer_managed: true },
  });
  if (error || !data.user)
    throw new Error("Não foi possível criar a conta. Verifique a senha.");
  const u = data.user.id;
  const { data: ch, error: e } = await db.rpc("provision_player", {
    c: campaign,
    u,
    uname: username,
    identity,
    cipher: encrypt(password, u),
    d: character,
    claim: claim || null,
    actor: actor || null,
  });
  if (e) {
    const rollback = await db.auth.admin.deleteUser(u);
    if (rollback.error)
      throw new Error("Cadastro pendente de reparo administrativo.");
    const databaseMessage =
      typeof e.message === "string" ? e.message : "";
    const slotMessage =
      databaseMessage.startsWith("Não há mais vagas para a classe") ||
      databaseMessage.startsWith("Não há mais vagas para a raça") ||
      databaseMessage === "Classe inválida" ||
      databaseMessage === "Raça inválida";
    throw new Error(
      e.code === "23505"
        ? "Username já utilizado."
        : slotMessage
          ? databaseMessage
          : "Cadastro não concluído. Verifique os campos.",
    );
  }
  return ch;
}
export async function credential(
  campaign: string,
  userId: string,
  playersOnly = true,
) {
  const db = admin();
  const { data: m } = await db
    .from("campaign_members")
    .select("role")
    .eq("campaign_id", campaign)
    .eq("user_id", userId)
    .single();
  if (!m || (playersOnly && m.role !== "player"))
    throw new Error(
      playersOnly ? "Jogador não encontrado" : "Conta não encontrada",
    );
  const { data: v, error } = await db
    .from("credential_vault")
    .select("*")
    .eq("user_id", userId)
    .single();
  if (error || !v) throw new Error("Credencial indisponível");
  if (v.pending_ciphertext) {
    if (Date.now() - Date.parse(v.locked_at) < 60000)
      throw new Error("Alteração de senha em andamento. Aguarde um minuto.");
    const pending = decrypt(v.pending_ciphertext, userId);
    const probe = publicAuth();
    let valid = await probe.auth.signInWithPassword({
      email: v.identity,
      password: pending,
    });
    let success = !valid.error;
    if (valid.data.session) await probe.auth.signOut();
    if (!success) {
      valid = await probe.auth.signInWithPassword({
        email: v.identity,
        password: decrypt(v.ciphertext, userId),
      });
      if (valid.error)
        throw new Error("Reconciliação pendente. Tente novamente mais tarde.");
      await probe.auth.signOut();
    }
    const done = await db.rpc("finish_credential", {
      u: userId,
      expected: v.pending_ciphertext,
      success,
    });
    if (done.error) throw new Error("Reconciliação pendente");
    return {
      password: success ? pending : decrypt(v.ciphertext, userId),
      identity: v.identity,
    };
  }
  return { password: decrypt(v.ciphertext, userId), identity: v.identity };
}

export async function changeCredential(
  db: any,
  userId: string,
  password: string,
) {
  const cipher = encrypt(password, userId);
  const lock = await db.rpc("lock_credential", { u: userId, cipher });
  if (lock.error) throw new Error(lock.error.message);
  const change = await db.auth.admin.updateUserById(userId, { password });
  if (change.error)
    throw new Error(
      "Alteração pendente. Consulte a senha após um minuto para reconciliar.",
    );
  const done = await db.rpc("finish_credential", {
    u: userId,
    expected: cipher,
    success: true,
  });
  if (done.error)
    throw new Error(
      "Senha alterada; confirmação pendente. Consulte após um minuto.",
    );
}
