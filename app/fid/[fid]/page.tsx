"use client";

import { useParams } from "next/navigation";
import PublicFarcasterProfile from "@/components/farcaster/PublicFarcasterProfile";

export default function FidProfilePage() {
  const params = useParams<{ fid: string }>();
  const fid = Array.isArray(params.fid) ? params.fid[0] : params.fid;
  if (!fid || !/^\d+$/.test(fid)) {
    return <p>Invalid FID.</p>;
  }
  return <PublicFarcasterProfile kind="fid" value={fid} />;
}
