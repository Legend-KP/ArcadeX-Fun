/**
 * ArcadeX only builds CastAdd messages.
 * Farcaster itself does not enforce that limit on an on-chain signer key.
 * The approval text says so, and the signing module refuses every other type.
 */

export const CAST_ONLY_PERMISSION = "cast_add" as const;

export const CAST_TEXT_MAX_BYTES = 320;

/** Per-account cast caps. Enforced before any key is unwrapped. */
export const CAST_HOURLY_LIMIT = 10;
export const CAST_DAILY_LIMIT = 40;

export const SIGNER_APPROVAL_TTL_SEC = 60 * 60;

export const REVOKE_INSTRUCTIONS = [
  "In the Farcaster app, open Settings, then Advanced, then Signers.",
  "Remove the signer whose public key matches the key ArcadeX shows you.",
  "Removing it there stops every app from using that key, including ArcadeX.",
  "You can also use Remove signer here. That asks your Farcaster custody wallet to submit KeyRegistry.removeFor on Optimism.",
] as const;

export function signerGrantText(input: {
  fid: number;
  publicKey: string;
  generation: number;
  appFid: number | null;
}): string {
  const appLine = input.appFid
    ? `ArcadeX app fid ${input.appFid} signs the on-chain key request, so Farcaster clients can show that ArcadeX asked for this key.`
    : "ArcadeX's app account is not configured, so this key is added without app attribution metadata.";

  return [
    "ArcadeX is asking to add a Farcaster signer for your account.",
    `Account fid: ${input.fid}`,
    `Signer public key: ${input.publicKey}`,
    `Key generation: ${input.generation}`,
    "ArcadeX will use this key only to sign CastAdd posts: text, no embeds, no mentions.",
    "Those posts are submitted to a Farcaster hub so they can show on your profile.",
    "ArcadeX will not sign reactions, follows, profile changes, verifications, deletes, or any message that is not a CastAdd.",
    "Farcaster does not enforce that limit on the key. A standard signer can sign other message types if its private key leaks. The private key is envelope-encrypted in a vault separate from the ArcadeX database. Remove the key in Farcaster settings if you stop trusting ArcadeX.",
    appLine,
    "Approving signs a Farcaster KeyGateway Add for this exact public key. Your custody wallet then submits that Add on Optimism and pays the storage fee.",
  ].join("\n");
}
