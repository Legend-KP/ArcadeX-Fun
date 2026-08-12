/**
 * Reject ABI calldata / padded selectors that look like 32-byte hex
 * but are not real transaction hashes (e.g. checkIn selector 0xfd649abf + zeros).
 */
export function isPlausibleEvmTxHash(value: unknown): value is `0x${string}` {
  if (typeof value !== "string") return false;
  const hash = value.trim().toLowerCase();
  if (!/^0x[a-f0-9]{64}$/.test(hash)) return false;
  if (/^0x0+$/.test(hash)) return false;

  // Real tx hashes are keccak256 digests — reject sparse / padded calldata.
  const body = hash.slice(2);
  const zeroCount = (body.match(/0/g) ?? []).length;
  if (zeroCount >= 48) return false;

  // First 4 bytes matching a function selector + 28 zero bytes is calldata, not a hash.
  if (/^0x[a-f0-9]{8}0{56}$/.test(hash)) return false;

  return true;
}

/** Pull a real broadcast tx hash from wagmi/viem errors — never ABI calldata. */
export function extractSubmittedTxHash(error: unknown): `0x${string}` | null {
  const candidates: unknown[] = [];
  let current: unknown = error;
  for (let i = 0; i < 6 && current; i++) {
    candidates.push(current);
    if (current && typeof current === "object") {
      const obj = current as Record<string, unknown>;
      if ("hash" in obj) candidates.push(obj.hash);
      if ("transactionHash" in obj) candidates.push(obj.transactionHash);
      if ("cause" in obj) current = obj.cause;
      else break;
    } else break;
  }

  for (const value of candidates) {
    if (isPlausibleEvmTxHash(value)) return value;
  }

  // Do NOT regex-scan error text for 0x…64 — that matches calldata in revert data.
  return null;
}
