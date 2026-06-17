export function buildAuthPlainMessage(nonce: string): string {
  const issuedAt = new Date().toISOString();
  return `Sign in to ArcadeX\nNonce: ${nonce}\nIssued At: ${issuedAt}`;
}

export function buildSiweStatement(): string {
  return "Sign in to ArcadeX";
}
