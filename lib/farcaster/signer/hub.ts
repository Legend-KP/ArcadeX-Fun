import { hubUrl } from "@/lib/farcaster/signer/config";
import { SignerHttpError } from "@/lib/farcaster/signer/errors";

function hubErrorDetail(body: string): string {
  try {
    const parsed = JSON.parse(body) as {
      errCode?: string;
      error?: string;
      message?: string;
    };
    const candidate = parsed.errCode || parsed.error || parsed.message || "";
    if (
      typeof candidate === "string" &&
      candidate.length > 0 &&
      candidate.length < 180 &&
      !/signature|private|seed|key/i.test(candidate)
    ) {
      return candidate;
    }
  } catch {
    // Hub bodies can be protobuf or HTML. The status code is enough.
  }
  return "";
}

/** Submit a signed message and let the hub replicate it. */
export async function submitMessage(message: Uint8Array): Promise<{ hash: string | null }> {
  const headers: Record<string, string> = {
    "Content-Type": "application/octet-stream",
  };
  const username = process.env.FARCASTER_HUB_USERNAME?.trim();
  const password = process.env.FARCASTER_HUB_PASSWORD?.trim();
  if (username && password) {
    headers.Authorization = `Basic ${btoa(`${username}:${password}`)}`;
  }
  const base = hubUrl();
  if (base.includes("neynar.com") && process.env.NEYNAR_API_KEY?.trim()) {
    headers["x-api-key"] = process.env.NEYNAR_API_KEY.trim();
  }

  const response = await fetch(`${base}/v1/submitMessage`, {
    method: "POST",
    headers,
    body: message as BodyInit,
  });
  const body = await response.text();
  if (!response.ok) {
    const detail = hubErrorDetail(body);
    throw new SignerHttpError(
      detail
        ? `Farcaster hub rejected the cast (${response.status}): ${detail}`
        : `Farcaster hub rejected the cast (${response.status}).`,
      502
    );
  }

  try {
    const parsed = JSON.parse(body) as { hash?: string };
    return { hash: typeof parsed.hash === "string" ? parsed.hash : null };
  } catch {
    return { hash: null };
  }
}
