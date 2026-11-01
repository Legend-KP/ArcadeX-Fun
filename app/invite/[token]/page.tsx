"use client";

import dynamic from "next/dynamic";
import { useParams } from "next/navigation";

const InviteLanding = dynamic(
  () => import("@/components/social/InviteLanding"),
  { ssr: false }
);

export default function InvitePage() {
  const { token } = useParams<{ token: string }>();
  if (!token) return null;
  return <InviteLanding token={token} />;
}
