import { edgeProxy } from "@/lib/edge-proxy";

export async function POST(req: Request) {
  return edgeProxy(req, "mobile-gallery");
}
