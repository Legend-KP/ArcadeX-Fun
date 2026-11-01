"use client";

import dynamic from "next/dynamic";

const CirclesHome = dynamic(() => import("@/components/social/CirclesHome"), {
  ssr: false,
});

export default function CirclesPage() {
  return <CirclesHome />;
}
