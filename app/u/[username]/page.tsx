"use client";

import { useParams } from "next/navigation";
import PublicFarcasterProfile from "@/components/farcaster/PublicFarcasterProfile";

export default function UsernameProfilePage() {
  const params = useParams<{ username: string }>();
  const username = Array.isArray(params.username)
    ? params.username[0]
    : params.username;
  return (
    <PublicFarcasterProfile
      kind="username"
      value={(username ?? "").toLowerCase()}
    />
  );
}
