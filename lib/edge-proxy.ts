import "server-only";
export async function edgeProxy(
  req: Request,
  route: "auth" | "admin" | "push",
) {
  try {
    const origin = req.headers.get("origin");
    const allowed = [
      process.env.APP_ORIGIN,
      process.env.VERCEL_URL && `https://${process.env.VERCEL_URL}`,
      process.env.VERCEL_PROJECT_PRODUCTION_URL &&
        `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`,
      process.env.NODE_ENV !== "production" && "http://localhost:3000",
    ]
      .filter((value): value is string => Boolean(value))
      .map((value) => new URL(value).origin);
    const expected = origin && allowed.includes(origin) ? origin : null;
    if (!expected)
      return Response.json({ error: "Origem não permitida" }, { status: 403 });
    const body = await req.text();
    if (body.length > 100000)
      return Response.json({ error: "Pedido muito grande" }, { status: 413 });
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL,
      key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key)
      return Response.json(
        { error: "Supabase não configurado" },
        { status: 503 },
      );

    const functionPath =
      route === "push" ? "alvorecer-push" : `alvorecer-api/${route}`;

    const response = await fetch(`${url}/functions/v1/${functionPath}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: key,
        ...(req.headers.get("authorization")
          ? { Authorization: req.headers.get("authorization")! }
          : {}),
      },
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(45000),
    });
    let payload = await response.text();
    try {
      const parsed = JSON.parse(payload);
      if (
        typeof parsed.url === "string" &&
        parsed.url.startsWith("/convite/")
      )
        payload = JSON.stringify({ ...parsed, url: expected + parsed.url });
    } catch {}
    return new Response(payload, {
      status: response.status,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return Response.json(
      { error: "Não foi possível conectar ao servidor. Tente novamente." },
      { status: 502 },
    );
  }
}
