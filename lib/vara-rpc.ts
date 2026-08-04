/**
 * Stub Gear RPC client for Cloudflare Worker size limits.
 * Real GearApi lives in client-only Vara flows via dynamic import.
 */
export function getVaraRpcUrl(): string {
  return (
    process.env.NEXT_PUBLIC_VARA_RPC_URL?.trim() || "wss://rpc.vara.network"
  );
}

export async function getVaraGearApi(): Promise<never> {
  throw new Error(
    "Vara RPC is not available in this deployment. Use Base (EVM) or Sui."
  );
}

export async function disconnectVaraGearApi(): Promise<void> {}
