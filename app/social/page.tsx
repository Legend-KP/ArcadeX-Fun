"use client";

import { Suspense } from "react";
import dynamic from "next/dynamic";

const SocialShell = dynamic(
  () => import("@/components/farcaster/SocialShell"),
  { ssr: false }
);

export default function SocialPage() {
  return (
    <Suspense fallback={null}>
      <SocialShell />
    </Suspense>
  );
}
