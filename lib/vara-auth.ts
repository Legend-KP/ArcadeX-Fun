export function buildVaraAuthMessage(
  nonce: string,
  domain: string,
  uri: string
): string {
  const issuedAt = new Date().toISOString();
  return [
    "Sign in to ArcadeX",
    `Domain: ${domain}`,
    `URI: ${uri}`,
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAt}`,
  ].join("\n");
}

function parseAuthField(message: string, label: string): string | null {
  const match = message.match(new RegExp(`^${label}: (.+)$`, "m"));
  return match?.[1]?.trim() ?? null;
}

/**
 * Domain-bound Vara sign-in (SIWE equivalent). Rejects messages that omit
 * Domain/URI so a signature for another origin cannot be replayed here.
 */
export function isVaraAuthMessageValid(
  message: string,
  nonce: string,
  expectedDomain: string
): boolean {
  if (!message.startsWith("Sign in to ArcadeX\n")) return false;
  if (!message.includes(`Nonce: ${nonce}`)) return false;

  const domain = parseAuthField(message, "Domain");
  const uri = parseAuthField(message, "URI");
  if (!domain || domain !== expectedDomain) return false;
  if (!uri) return false;

  try {
    return new URL(uri).host === expectedDomain;
  } catch {
    return false;
  }
}
