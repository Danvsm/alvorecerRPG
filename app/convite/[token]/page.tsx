import Game from "@/components/Game";
export default async function Invite({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <Game invite={token} />;
}
