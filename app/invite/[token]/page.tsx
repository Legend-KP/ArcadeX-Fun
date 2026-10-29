import InviteLanding from "@/components/social/InviteLanding";

export const dynamic = "force-dynamic";

export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <InviteLanding token={token} />;
}
