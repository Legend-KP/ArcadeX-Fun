"use client";

import dynamic from "next/dynamic";
import { useParams } from "next/navigation";

const CircleDetail = dynamic(() => import("@/components/social/CircleDetail"), {
  ssr: false,
});

export default function CirclePage() {
  const { id } = useParams<{ id: string }>();
  if (!id) return null;
  return <CircleDetail circleId={id} />;
}
