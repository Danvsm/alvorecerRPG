import { RECRUITMENT_OFFLINE_PLAYERS } from "@/lib/recruitment";
import { z } from "zod";

const countsSchema = z.object({
  registeredPlayers: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER - RECRUITMENT_OFFLINE_PLAYERS),
  applications: z.number().int().nonnegative(),
});

export async function GET() {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) throw new Error("Missing configuration");
    const response = await fetch(url + "/rest/v1/rpc/public_recruitment_counts", {
      method: "POST",
      headers: { apikey: key, Authorization: "Bearer " + key, "Content-Type": "application/json" },
      body: "{}",
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error("Counts unavailable");
    const counts = countsSchema.parse(await response.json());
    const players = counts.registeredPlayers + RECRUITMENT_OFFLINE_PLAYERS;
    const total = players + counts.applications;
    if (!Number.isSafeInteger(total)) throw new Error("Invalid count");
    return Response.json({ players, applications: counts.applications, total }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return Response.json({ error: "Contagem temporariamente indisponível." }, {
      status: 503, headers: { "Cache-Control": "no-store" },
    });
  }
}
