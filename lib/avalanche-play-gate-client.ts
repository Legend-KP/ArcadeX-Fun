"use client";

import {
  AVALANCHE_PLAY_GATE_CHAIN_ID,
  AVALANCHE_PLAY_GATE_TTL_MS,
  buildAvalanchePlayGateMessage,
} from "@/lib/avalanche-play-gate";

export async function signAvalanchePlayIntent(params: {
  gameId: string;
  address: string;
  chainId?: number;
  signMessageAsync: (args: { message: string }) => Promise<string>;
}): Promise<{ message: string; signature: string }> {
  const issuedAt = Date.now();
  const expiresAt = issuedAt + AVALANCHE_PLAY_GATE_TTL_MS;
  const message = buildAvalanchePlayGateMessage({
    gameId: params.gameId,
    address: params.address,
    chainId: params.chainId ?? AVALANCHE_PLAY_GATE_CHAIN_ID,
    issuedAt,
    expiresAt,
  });
  const signature = await params.signMessageAsync({ message });
  return { message, signature };
}
