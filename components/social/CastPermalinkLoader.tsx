"use client";

import dynamic from "next/dynamic";

const CastPermalink = dynamic(() => import("@/components/social/CastPermalink"), {
  ssr: false,
});

export default function CastPermalinkLoader({ id }: { id: string }) {
  return <CastPermalink id={id} />;
}
