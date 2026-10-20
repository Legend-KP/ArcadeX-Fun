/**
 * Cloudflare Turnstile. Enforced only when TURNSTILE_SECRET_KEY is set,
 * so local and staging deploys keep working before the widget keys exist.
 */
export async function assertTurnstile(
  token: string | undefined,
  ip: string
): Promise<void> {
  const secret = process.env.TURNSTILE_SECRET_KEY?.trim();
  if (!secret) return;

  if (!token?.trim()) {
    throw new Error("Complete the CAPTCHA before continuing.");
  }

  const body = new URLSearchParams({
    secret,
    response: token.trim(),
  });
  if (ip && ip !== "unknown") {
    body.set("remoteip", ip);
  }

  const res = await fetch(
    "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    }
  );
  const data = (await res.json()) as { success?: boolean };
  if (!data.success) {
    throw new Error("CAPTCHA check failed. Try again.");
  }
}
