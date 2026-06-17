import { createConfig, http } from "wagmi";
import {
  coinbaseWallet,
  metaMask,
  walletConnect,
} from "wagmi/connectors";
import { supportedEvmChains } from "@/lib/chains";

const projectId =
  process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID?.trim() || "arcadex-dev";

const transports = Object.fromEntries(
  supportedEvmChains.map((chain) => [chain.id, http()])
) as Record<number, ReturnType<typeof http>>;

export const wagmiConfig = createConfig({
  chains: [...supportedEvmChains],
  connectors: [
    metaMask(),
    coinbaseWallet({ appName: "ArcadeX" }),
    walletConnect({ projectId, showQrModal: true }),
  ],
  transports,
  ssr: true,
});
