"use client";

import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import SparkProvider from "@/components/SparkProvider";
import ChainSettingsProvider from "@/components/ChainSettingsProvider";

const WalletProvider = dynamic(() => import("@/components/WalletProvider"), {
  ssr: false,
});

const PlayerProfileProvider = dynamic(
  () => import("@/components/PlayerProfileProvider"),
  { ssr: false }
);

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
      <ChainSettingsProvider>
        <PlayerProfileProvider>
          <SparkProvider>{children}</SparkProvider>
        </PlayerProfileProvider>
      </ChainSettingsProvider>
    </WalletProvider>
  );
}
