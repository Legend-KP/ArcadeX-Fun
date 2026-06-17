"use client";

import { usePathname } from "next/navigation";
import WalletProvider from "@/components/WalletProvider";
import PlayerProfileProvider from "@/components/PlayerProfileProvider";

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
      <PlayerProfileProvider>{children}</PlayerProfileProvider>
    </WalletProvider>
  );
}
