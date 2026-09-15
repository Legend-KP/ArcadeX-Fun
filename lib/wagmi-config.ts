import { createConfig, http } from "wagmi";
import {
  coinbaseWallet,
  injected,
  walletConnect,
} from "wagmi/connectors";
import { supportedEvmChains } from "@/lib/chains";
import {
  getRabbyInjectedProvider,
  getRoninInjectedProvider,
  getTrustInjectedProvider,
} from "@/lib/evm-injected-providers";

const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID?.trim() ?? "";
const hasWalletConnectProject =
  Boolean(projectId) && projectId !== "arcadex-dev";

/** WalletConnect explorer IDs — used to rank Ronin + common EVM wallets. */
const WALLETCONNECT_RECOMMENDED_IDS = [
  "541d5dcd4ede02f3afaf75bf8e3e4c4f1fb09edb5fa6c4377ebf31c2785d9adf", // Ronin Wallet
  "c57ca95b47569778a828d19178114f4db188b89b763c899ba0be274e97267d96", // MetaMask
  "18388be9ac2d02726dbac9777c96efaac06d744b2f6d580fccdd4127a6d01fd1", // Rabby
  "fd20dc426fb37566d803205b19bbc1d4096b248ac04548e3cfb6b3a38bd1598", // Coinbase Wallet
  "4622a2b2d6af1c9844944291e5e7351a6aa24cd7b23099efac1b2fd875da31a0", // Trust Wallet
];

const transports = Object.fromEntries(
  supportedEvmChains.map((chain) => [chain.id, http()])
) as Record<number, ReturnType<typeof http>>;

export const wagmiConfig = createConfig({
  chains: [...supportedEvmChains],
  connectors: [
    // Use the in-page extension, not MetaMask Connect SDK.
    // The SDK hunts for the extension over a separate channel, logs
    // "MetaMask extension not found", and retries until the UI hangs.
    injected({ target: "metaMask" }),
    injected({
      target: {
        id: "ronin",
        name: "Ronin Wallet",
        // Ronin is not in wagmi's built-in target map; read window.ronin.provider.
        provider: (win) => getRoninInjectedProvider(win) as never,
      },
      unstable_shimAsyncInject: 1_500,
    }),
    injected({
      target: {
        id: "rabby",
        name: "Rabby",
        provider: (win) => getRabbyInjectedProvider(win) as never,
      },
    }),
    injected({
      target: {
        id: "trust",
        name: "Trust Wallet",
        provider: (win) => getTrustInjectedProvider(win) as never,
      },
    }),
    coinbaseWallet({ appName: "ArcadeX" }),
    // Skip WalletConnect when project id is missing/placeholder — avoids
    // WebSocket 3000 "Project not found" and AppKit 403 spam.
    ...(hasWalletConnectProject
      ? [
          walletConnect({
            projectId,
            showQrModal: true,
            // Adding Ronin should not kick existing WalletConnect sessions.
            isNewChainsStale: false,
            qrModalOptions: {
              explorerRecommendedWalletIds: WALLETCONNECT_RECOMMENDED_IDS,
            },
          }),
        ]
      : []),
  ],
  transports,
  ssr: true,
});
