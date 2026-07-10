import { GearApi } from "@gear-js/api";
import { VARA_RPC_URL } from "@/lib/shop-vara";

let clientPromise: Promise<GearApi> | null = null;

export function getVaraRpcUrl(): string {
  return VARA_RPC_URL;
}

export async function getVaraGearApi(): Promise<GearApi> {
  if (!clientPromise) {
    clientPromise = GearApi.create({
      providerAddress: getVaraRpcUrl(),
    }).catch((err) => {
      clientPromise = null;
      throw err;
    });
  }

  return clientPromise;
}

export async function disconnectVaraGearApi(): Promise<void> {
  if (!clientPromise) return;

  const api = await clientPromise;
  await api.disconnect();
  clientPromise = null;
}
