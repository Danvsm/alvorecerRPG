import { POST as auth } from "./auth.ts";
import { POST as adminRoute } from "./admin.ts";
import { admin, hash } from "./server.ts";
import { encrypt, setKey } from "./crypto.ts";
import { cleanup } from "./media-cleanup.ts";
import { finalizeAudio } from "./audio-finalize.ts";
import { mobileGallery } from "./mobile-gallery.ts";
let keyReady: Promise<void> | null = null;
async function initialize() {
  if (!keyReady)
    keyReady = (async () => {
      const { data, error } = await admin().rpc("server_credential_key");
      if (error || !data) throw new Error("Cofre indisponível");
      setKey(data);
    })().catch((e) => {
      keyReady = null;
      throw e;
    });
  await keyReady;
}
Deno.serve(async (req: Request) => {
  try {
    if (req.method !== "POST")
      return Response.json({ error: "Método não permitido" }, { status: 405 });
    if (Number(req.headers.get("content-length") || 0) > 300000)
      return Response.json({ error: "Pedido muito grande" }, { status: 413 });
    await initialize();
    const path = new URL(req.url).pathname.split("/").pop();
    if (path === "media-cleanup") return cleanup(req);
    if (path === "chat-audio-finalize") return await finalizeAudio(req);
    if (path === "mobile-gallery") return await mobileGallery(req);
    if (path === "auth") return auth(req);
    if (path === "admin") return adminRoute(req);
    if (path === "bootstrap") {
      const d = await req.json();
      if (
        typeof d.token !== "string" ||
        typeof d.password !== "string" ||
        d.password.length < 8 ||
        !/^[a-z0-9_]{3,32}$/.test(d.username)
      )
        throw new Error("Configuração inválida");
      const db = admin();
      const claim = await db.rpc("claim_bootstrap", { h: hash(d.token) });
      if (claim.error || !claim.data)
        throw new Error("Configuração inicial indisponível");
      const identity = `${crypto.randomUUID()}@auth.alvorecer.invalid`;
      const reserve = await db.rpc("reserve_auth_identity", { identity });
      if (reserve.error) throw new Error("Falha ao preparar mestre");
      const { data, error } = await db.auth.admin.createUser({
        email: identity,
        password: d.password,
        email_confirm: true,
        app_metadata: { alvorecer_managed: true },
      });
      if (error || !data.user)
        throw new Error(
          "Falha ao criar mestre: " + (error?.message || "Resposta vazia"),
        );
      const result = await db.rpc("bootstrap_campaign", {
        u: data.user.id,
        uname: d.username,
        identity,
        cipher: encrypt(d.password, data.user.id),
      });
      if (result.error) {
        await db.auth.admin.deleteUser(data.user.id);
        throw new Error("Falha na configuração da campanha");
      }
      return Response.json(
        { campaign_id: result.data },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    return Response.json({ error: "Rota não encontrada" }, { status: 404 });
  } catch (e) {
    return Response.json(
      { error: (e as Error).message },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
});
