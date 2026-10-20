"use client";

import dynamic from "next/dynamic";
import LoadingScreen from "@/components/LoadingScreen";

const SocialProfilePage = dynamic(
  () => import("@/components/social/SocialProfilePage"),
  { ssr: false, loading: () => <LoadingScreen /> }
);

export default function ProfilePage() {
  return <SocialProfilePage />;
}
