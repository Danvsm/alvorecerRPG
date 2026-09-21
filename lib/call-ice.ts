export const STUN_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];

export type CallIceConfig = {
  iceServers: RTCIceServer[];
  relayAvailable: boolean;
};

/** Called only by the server route. The long-lived token never leaves it. */
export async function issueCallIceConfig(
  keyId: string | undefined,
  apiToken: string | undefined,
  request: typeof fetch = fetch,
): Promise<CallIceConfig> {
  if (!keyId && !apiToken)
    return { iceServers: STUN_SERVERS, relayAvailable: false };
  if (!keyId || !apiToken) throw new Error("Configuração TURN incompleta.");
  const response = await request(
    `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(keyId)}/credentials/generate-ice-servers`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ttl: 14400 }),
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    },
  );
  if (!response.ok)
    throw new Error("Não foi possível preparar a conexão de voz.");
  const body = await response.json();
  const iceServers: RTCIceServer[] = [];
  for (const entry of Array.isArray(body.iceServers) ? body.iceServers : []) {
    const urls = (Array.isArray(entry.urls) ? entry.urls : [entry.urls]).filter(
      (url: unknown): url is string =>
        typeof url === "string" &&
        /^(stun|turn|turns):/.test(url) &&
        !/:53(?:\?|$)/.test(url),
    );
    if (!urls.length) continue;
    const relay = urls.some((url: string) => /^turns?:/.test(url));
    if (
      relay &&
      (typeof entry.username !== "string" ||
        typeof entry.credential !== "string")
    )
      continue;
    iceServers.push(
      relay
        ? { urls, username: entry.username, credential: entry.credential }
        : { urls },
    );
  }
  if (
    !iceServers.some((entry) =>
      (entry.urls as string[]).some((url) => /^turns?:/.test(url)),
    )
  ) {
    throw new Error("O serviço de voz não forneceu uma rota de retransmissão.");
  }
  return { iceServers, relayAvailable: true };
}
