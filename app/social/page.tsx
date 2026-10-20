"use client";

import dynamic from "next/dynamic";

const SocialShell = dynamic(
  () => import("@/components/farcaster/SocialShell"),
  { ssr: false }
);

export default function SocialPage() {
  return <SocialShell />;
}
