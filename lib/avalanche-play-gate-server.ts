import { verifyMessage, type Hex } from "viem";
import {
  AVALANCHE_PLAY_GATE_CHAIN_ID,
  AVALANCHE_PLAY_GATE_TTL_MS,
  parseAvalanchePlayGateMessage,
} from "@/lib/avalanche-play-gate";
import { normalizeEvmAddress } from "@/lib/player-identity";
import {
  getPlayerRtdbConnection,
  type RtdbConnection,
} from "@/lib/rtdb-resolver";
import { rtdbReadWithEtag, rtdbWriteIfMatch } from "@/lib/rtdb-rest";

export class AvalanchePlayGateError extends Error {
  constructor(
    message: string,
    readonly code:
      | "INVALID_MESSAGE"
      | "EXPIRED"
      | "BAD_SIGNATURE"
      | "ALREADY_USED"
      | "MISMATCH"
  ) {
    super(message);
    this.name = "AvalanchePlayGateError";
  }
}

function gatePath(sigHash: string): string {
  return `avalanche/playGates/${sigHash}`;
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0")
  ).join("");
}

/**
 * Verify Avalanche off-chain PLAY intent and claim the signature (replay guard).
 */
export async function verifyAndClaimAvalanchePlayGate(params: {
  message: string;
  signature: string;
  expectedFrom: string;
  gameId: string;
  chainId?: number | null;
  now?: number;
}): Promise<{ sigHash: string }> {
  const parsed = parseAvalanchePlayGateMessage(params.message);
  if (!parsed) {
    throw new AvalanchePlayGateError(
      "Invalid play intent message.",
      "INVALID_MESSAGE"
    );
  }

  const expected = normalizeEvmAddress(params.expectedFrom);
  let messageAddress: string;
  try {
    messageAddress = normalizeEvmAddress(parsed.address);
  } catch {
    throw new AvalanchePlayGateError(
      "Invalid address in play intent.",
      "INVALID_MESSAGE"
    );
  }

  if (messageAddress !== expected) {
    throw new AvalanchePlayGateError(
      "Play intent address does not match your session.",
      "MISMATCH"
    );
  }

  if (parsed.gameId !== params.gameId.trim()) {
    throw new AvalanchePlayGateError(
      "Play intent game does not match.",
      "MISMATCH"
    );
  }

  if (parsed.chainId !== AVALANCHE_PLAY_GATE_CHAIN_ID) {
    throw new AvalanchePlayGateError(
      "Play intent chain mismatch.",
      "MISMATCH"
    );
  }

  const now = params.now ?? Date.now();
  if (parsed.expiresAt <= now || parsed.issuedAt > now + 60_000) {
    throw new AvalanchePlayGateError(
      "Play intent expired. Sign again.",
      "EXPIRED"
    );
  }

  if (parsed.expiresAt - parsed.issuedAt > AVALANCHE_PLAY_GATE_TTL_MS + 30_000) {
    throw new AvalanchePlayGateError(
      "Play intent TTL too long.",
      "INVALID_MESSAGE"
    );
  }

  const ok = await verifyMessage({
    address: expected as `0x${string}`,
    message: params.message,
    signature: params.signature as Hex,
  });

  if (!ok) {
    throw new AvalanchePlayGateError(
      "Invalid play intent signature.",
      "BAD_SIGNATURE"
    );
  }

  const sigHash = await sha256Hex(
    `${params.signature.trim().toLowerCase()}:${parsed.gameId}`
  );
  const connection: RtdbConnection = getPlayerRtdbConnection({
    chainId: AVALANCHE_PLAY_GATE_CHAIN_ID,
    ecosystem: "evm",
  });

  const record = {
    wallet: expected,
    gameId: parsed.gameId,
    claimedAt: now,
    expiresAt: parsed.expiresAt,
  };

  // Atomic claim via ETag conditional write.
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data, etag } = await rtdbReadWithEtag<{ wallet?: string }>(
      gatePath(sigHash),
      { connection }
    );
    if (data?.wallet) {
      throw new AvalanchePlayGateError(
        "This play intent was already used.",
        "ALREADY_USED"
      );
    }
    const result = await rtdbWriteIfMatch(gatePath(sigHash), record, etag, {
      connection,
    });
    if (result === "ok") {
      return { sigHash };
    }
  }

  throw new AvalanchePlayGateError(
    "This play intent was already used.",
    "ALREADY_USED"
  );
}
