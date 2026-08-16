/**
 * Fail closed on missing secrets — never boot an insecure "trust the caller" mode.
 */

function isProductionRuntime(): boolean {
  return (
    process.env.NODE_ENV === "production" ||
    process.env.CF_PAGES === "1" ||
    Boolean(process.env.CF_WORKER)
  );
}

export function getMissingRequiredSecrets(): string[] {
  const missing: string[] = [];

  if (!process.env.WALLET_SESSION_SECRET?.trim()) {
    missing.push("WALLET_SESSION_SECRET");
  }

  if (!process.env.AUTH_SECRET?.trim()) {
    missing.push("AUTH_SECRET");
  }

  if (isProductionRuntime() && !process.env.ADMIN_PASSWORD?.trim()) {
    missing.push("ADMIN_PASSWORD");
  }

  // Fun prefers service-account OAuth for Firestore + RTDB.
  // Legacy FIREBASE_DATABASE_SECRET remains a fallback when no service account is set.
  const hasDbSecret = Boolean(process.env.FIREBASE_DATABASE_SECRET?.trim());
  const hasServiceAccount =
    Boolean(
      process.env.FIREBASE_PROJECT_ID?.trim() ||
        process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID?.trim()
    ) &&
    Boolean(process.env.FIREBASE_CLIENT_EMAIL?.trim()) &&
    Boolean(process.env.FIREBASE_PRIVATE_KEY?.trim());

  if (!hasDbSecret && !hasServiceAccount) {
    missing.push(
      "FIREBASE_PROJECT_ID + FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY (preferred) or FIREBASE_DATABASE_SECRET"
    );
  }

  return missing;
}

/**
 * Throws in production when required secrets are missing.
 * Safe to call on Worker/isolate boot and before wallet auth.
 */
export function assertRequiredSecrets(): void {
  const missing = getMissingRequiredSecrets();
  if (missing.length === 0) return;

  const message = `Missing required secrets: ${missing.join(", ")}. Refusing to start in an insecure configuration.`;

  if (isProductionRuntime()) {
    throw new Error(message);
  }

  console.warn(`[ArcadeX] ${message}`);
}

export function assertWalletSessionSecretConfigured(): void {
  const secret = process.env.WALLET_SESSION_SECRET?.trim();
  if (!secret) {
    throw new Error(
      "WALLET_SESSION_SECRET is not configured. Wallet-authenticated routes refuse to run without it."
    );
  }
}
