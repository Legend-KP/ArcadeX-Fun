const RESEND_API = "https://api.resend.com/emails";

export function resendFromAddress(): string {
  return (
    process.env.RESEND_FROM_EMAIL?.trim() || "ArcadeX <onboarding@resend.dev>"
  );
}

export async function sendResendEmail(input: {
  to: string;
  subject: string;
  text: string;
}): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("RESEND_API_KEY is not configured.");
  }

  const res = await fetch(RESEND_API, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: resendFromAddress(),
      to: [input.to],
      subject: input.subject,
      text: input.text,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Resend failed: ${errText.slice(0, 200)}`);
  }
}
