import CircleDetail from "@/components/social/CircleDetail";

export const dynamic = "force-dynamic";

export default async function CirclePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <CircleDetail circleId={id} />;
}
