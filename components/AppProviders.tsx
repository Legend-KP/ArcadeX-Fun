"use client";

import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import PlayerProfileProvider from "@/components/PlayerProfileProvider";
import SparkProvider from "@/components/SparkProvider";

const WalletProvider = dynamic(() => import("@/components/WalletProvider"), {
  ssr: false,
});

export default function AppProviders({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const isAdminRoute = pathname?.startsWith("/admin");

  if (isAdminRoute) {
    return <>{children}</>;
  }

  return (
    <WalletProvider>
      <PlayerProfileProvider>
        <SparkProvider>{children}</SparkProvider>
      </PlayerProfileProvider>
    </WalletProvider>
  );
}
