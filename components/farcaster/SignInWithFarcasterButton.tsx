"use client";

import { SignInButton } from "@farcaster/auth-kit";
import { useCallback, useRef, useState } from "react";

type Props = {
  onSuccess?: (payload: { fid: number; playerId: string }) => void;
  onError?: (message: string) => void;
};

type SiwfPayload = {
  message?: string;
  signature?: string;
  nonce?: string;
  fid?: number;
};

/**
 * Path A UI: one QR, one signature, then the ArcadeX session.
 * Auth Kit resets its channel when these callbacks change identity, which
 * closed the QR and opened a second one after the phone signature.
 */
export default function SignInWithFarcasterButton({
  onSuccess,
  onError,
}: Props) {
  const onSuccessRef = useRef(onSuccess);
  const onErrorRef = useRef(onError);
  onSuccessRef.current = onSuccess;
  onErrorRef.current = onError;

  const started = useRef(false);
  const [busy, setBusy] = useState(false);
  const [sealed, setSealed] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const completeSiwf = useCallback(async (payload: SiwfPayload) => {
    if (started.current) return;
    if (!payload.message || !payload.signature || !payload.nonce) {
      const message = "Missing SIWF message, signature, or nonce.";
      setStatus(message);
      onErrorRef.current?.(message);
      return;
    }

    started.current = true;
    setSealed(true);
    setBusy(true);
    setStatus("Verifying your Farcaster sign-in…");
    try {
      const res = await fetch("/api/farcaster/siwf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: payload.message,
          signature: payload.signature,
          nonce: payload.nonce,
        }),
      });
      const data = (await res.json()) as {
        error?: string;
        fid?: number;
        playerId?: string;
      };
      if (!res.ok) {
        throw new Error(data.error || "Sign-in failed.");
      }
      setStatus(data.fid ? `Signed in as FID ${data.fid}` : "Signed in");
      if (data.fid && data.playerId) {
        onSuccessRef.current?.({ fid: data.fid, playerId: data.playerId });
      }
    } catch (err) {
      started.current = false;
      setSealed(false);
      const message = err instanceof Error ? err.message : "Sign-in failed.";
      setStatus(message);
      onErrorRef.current?.(message);
    } finally {
      setBusy(false);
    }
  }, []);

  const handleSuccess = useCallback((payload: SiwfPayload) => {
    void completeSiwf(payload);
  }, [completeSiwf]);

  const handleError = useCallback((error?: { message?: string } | null) => {
    if (started.current) return;
    const message = error?.message || "Farcaster sign-in cancelled.";
    setStatus(message);
    onErrorRef.current?.(message);
  }, []);

  return (
    <div className="farcaster-siwf">
      {!sealed && (
        <div className="farcaster-siwf__native">
          <SignInButton
            hideSignOut
            onSuccess={handleSuccess}
            onError={handleError}
          />
        </div>
      )}
      <button
        type="button"
        className="sx-signin"
        disabled={busy || sealed}
        onClick={(event) => {
          if (busy || sealed) return;
          const native = event.currentTarget.parentElement?.querySelector(
            ".farcaster-siwf__native button"
          );
          if (native instanceof HTMLButtonElement) native.click();
        }}
      >
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden>
          <path
            d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1v-9.5Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinejoin="round"
          />
        </svg>
        {busy ? "Verifying" : "Sign in"}
      </button>
      {status && <p className="sx-muted">{status}</p>}
    </div>
  );
}
