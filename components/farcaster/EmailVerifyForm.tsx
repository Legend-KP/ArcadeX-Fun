"use client";

import { useState } from "react";
import TurnstileWidget from "@/components/farcaster/TurnstileWidget";

type Props = {
  onVerified: () => void;
};

export default function EmailVerifyForm({ onVerified }: Props) {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [turnstileToken, setTurnstileToken] = useState("");

  async function sendCode() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/farcaster/email/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, turnstileToken }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error || "Could not send the code.");
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send the code.");
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/farcaster/email/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error || "Incorrect code.");
      onVerified();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Incorrect code.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="sx-card">
      <div className="sx-card__head">
        <span className="sx-ico" aria-hidden>
          <svg viewBox="0 0 24 24" width="22" height="22">
            <rect x="3.5" y="5.5" width="17" height="13" rx="2" fill="none" stroke="currentColor" strokeWidth="1.8" />
            <path d="m4 7 8 6 8-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
          </svg>
        </span>
        <h2>Verify your email</h2>
      </div>
      <p className="sx-muted">
        ArcadeX emails a 6-digit code to confirm this address. It is used for
        your account, not marketing. Search stays locked until this is done.
      </p>
      <div className="sx-row">
        <input
          type="email"
          autoComplete="email"
          placeholder="you@email.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <button type="button" onClick={() => void sendCode()} disabled={busy || !email}>
          {sent ? "Resend" : "Send code"}
        </button>
      </div>
      <TurnstileWidget onToken={setTurnstileToken} />
      {sent && (
        <div className="sx-row">
          <input
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="6-digit code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          <button type="button" onClick={() => void verify()} disabled={busy || code.length < 6}>
            Verify
          </button>
        </div>
      )}
      {error && <p className="sx-error">{error}</p>}
    </section>
  );
}
