import { SignerHttpError } from "@/lib/farcaster/signer/errors";
import type { SignerEnvelope } from "@/lib/farcaster/signer/envelope";
import { getWorkerEnv } from "@/lib/worker-env";

function vaultKey(fid: number, generation: number): string {
  return `fid/${fid}/gen/${generation}`;
}

async function requireVault() {
  const env = await getWorkerEnv();
  const vault = env?.FARCASTER_SIGNER_VAULT;
  if (!vault) {
    throw new SignerHttpError(
      "FARCASTER_SIGNER_VAULT is not bound. Create a dedicated KV namespace and add it in wrangler.jsonc. Signer keys are not written to the social database.",
      503
    );
  }
  return vault;
}

export async function putSignerEnvelope(
  fid: number,
  generation: number,
  envelope: SignerEnvelope
): Promise<void> {
  const vault = await requireVault();
  await vault.put(vaultKey(fid, generation), JSON.stringify(envelope));
}

export async function getSignerEnvelope(
  fid: number,
  generation: number
): Promise<SignerEnvelope | null> {
  const vault = await requireVault();
  const raw = await vault.get(vaultKey(fid, generation));
  if (!raw) return null;
  const parsed = JSON.parse(raw) as SignerEnvelope;
  if (parsed?.v !== 1 || parsed.alg !== "A256GCM" || !parsed.ciphertext) {
    throw new SignerHttpError("Signer vault entry is not a supported envelope.", 503);
  }
  return parsed;
}

export async function deleteSignerEnvelope(
  fid: number,
  generation: number
): Promise<void> {
  const vault = await requireVault();
  if (!vault.delete) {
    throw new SignerHttpError("Signer vault binding cannot delete keys.", 503);
  }
  await vault.delete(vaultKey(fid, generation));
}
