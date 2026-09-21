import "server-only";
import { createClient } from "@supabase/supabase-js";
import { issueCallIceConfig, type CallIceConfig } from "@/lib/call-ice";

export const runtime = "nodejs";
const cache = new Map<
  string,
  { until: number; config: Promise<CallIceConfig> }
>();
const headers = { "Cache-Control": "private, no-store" };

export async function POST(req: Request) {
  const authorization = req.headers.get("authorization");
  if (!authorization?.startsWith("Bearer "))
    return Response.json(
      { error: "Entre novamente." },
      { status: 401, headers },
    );
  let callId: string;
  try {
    const text = await req.text();
    if (text.length > 256) throw new Error();
    callId = JSON.parse(text).callId;
    if (
      typeof callId !== "string" ||
      !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(callId)
    )
      throw new Error();
  } catch {
    return Response.json(
      { error: "Chamada inválida." },
      { status: 400, headers },
    );
  }
  try {
    const db = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        global: { headers: { Authorization: authorization } },
        auth: { persistSession: false, autoRefreshToken: false },
      },
    );
    const {
      data: { user },
      error,
    } = await db.auth.getUser(authorization.slice(7));
    if (error || !user)
      return Response.json(
        { error: "Sessão inválida." },
        { status: 401, headers },
      );
    // Use the caller's JWT and existing RLS, never the service role.
    const { data: call, error: denied } = await db
      .from("direct_calls")
      .select("id")
      .eq("id", callId)
      .eq("status", "active")
      .maybeSingle();
    if (denied || !call)
      return Response.json(
        { error: "Chamada indisponível." },
        { status: 403, headers },
      );

    const key = `${user.id}:${callId}`;
    for (const [key, item] of cache)
      if (item.until <= Date.now()) cache.delete(key);
    let item = cache.get(key);
    if (!item) {
      if (cache.size >= 256) cache.delete(cache.keys().next().value!);
      item = {
        until: Date.now() + 300000,
        config: issueCallIceConfig(
          process.env.TURN_KEY_ID,
          process.env.TURN_KEY_API_TOKEN,
        ),
      };
      cache.set(key, item);
    }
    try {
      return Response.json(await item.config, { headers });
    } catch {
      cache.delete(key);
      return Response.json(
        {
          error:
            "O serviço de conexão de voz está indisponível. Tente novamente.",
        },
        { status: 502, headers },
      );
    }
  } catch {
    return Response.json(
      { error: "Não foi possível preparar a chamada." },
      { status: 503, headers },
    );
  }
}
