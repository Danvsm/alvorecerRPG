export const STUN_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];

export type CallIceConfig = {
  iceServers: RTCIceServer[];
  relayAvailable: boolean;
};

export function buildCallRtcConfiguration(
  config: CallIceConfig,
  forceRelay = false,
): RTCConfiguration {
  return {
    iceServers: config.iceServers,
    // Keep this stable across setConfiguration() calls. Changing the pool size
    // after setLocalDescription() may throw InvalidModificationError.
    iceCandidatePoolSize: 0,
    // Initial setup may use the fastest route. Recovery deliberately switches
    // to TURN when available so restrictive NATs do not loop on a bad direct path.
    iceTransportPolicy:
      forceRelay && config.relayAvailable ? "relay" : "all",
  };
}

export async function resolveCallIceConfig(config: {
  meteredUsername?: string;
  meteredCredential?: string;
  cloudflareKeyId?: string;
  cloudflareApiToken?: string;
}): Promise<CallIceConfig> {
  const username = config.meteredUsername?.trim();
  const credential = config.meteredCredential?.trim();
  if (username || credential) {
    if (!username || !credential)
      throw new Error("Configuração Metered TURN incompleta.");
    return {
      relayAvailable: true,
      iceServers: [
        { urls: "stun:stun.relay.metered.ca:80" },
        {
          urls: [
            "turn:global.relay.metered.ca:80",
            "turn:global.relay.metered.ca:80?transport=tcp",
            "turn:global.relay.metered.ca:443",
            "turns:global.relay.metered.ca:443?transport=tcp",
          ],
          username,
          credential,
        },
      ],
    };
  }
  return issueCallIceConfig(config.cloudflareKeyId, config.cloudflareApiToken);
}

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
