import { createConfig, http } from "wagmi";
import {
  coinbaseWallet,
  metaMask,
  walletConnect,
} from "wagmi/connectors";
import { supportedEvmChains } from "@/lib/chains";

const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID?.trim() ?? "";
const hasWalletConnectProject =
  Boolean(projectId) && projectId !== "arcadex-dev";

const transports = Object.fromEntries(
  supportedEvmChains.map((chain) => [chain.id, http()])
) as Record<number, ReturnType<typeof http>>;

export const wagmiConfig = createConfig({
  chains: [...supportedEvmChains],
  connectors: [
    metaMask(),
    coinbaseWallet({ appName: "ArcadeX" }),
    // Skip WalletConnect when project id is missing/placeholder — avoids
    // WebSocket 3000 "Project not found" and AppKit 403 spam.
    ...(hasWalletConnectProject
      ? [walletConnect({ projectId, showQrModal: true })]
      : []),
  ],
  transports,
  ssr: true,
});
