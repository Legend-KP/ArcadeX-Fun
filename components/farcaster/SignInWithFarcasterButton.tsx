"use client";

import { SignInButton, useProfile } from "@farcaster/auth-kit";
import { useCallback, useState } from "react";

type Props = {
  onSuccess?: (payload: { fid: number; playerId: string }) => void;
  onError?: (message: string) => void;
};

/**
 * Path A UI: Auth Kit QR/sign-in → POST /api/farcaster/siwf → session cookie.
 */
export default function SignInWithFarcasterButton({
  onSuccess,
  onError,
}: Props) {
  const { isAuthenticated, profile } = useProfile();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const completeSiwf = useCallback(
    async (payload: {
      message?: string;
      signature?: string;
      nonce?: string;
      fid?: number;
    }) => {
      if (!payload.message || !payload.signature || !payload.nonce) {
        onError?.("Missing SIWF message, signature, or nonce.");
        return;
      }

      setBusy(true);
      setStatus("Verifying…");
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
        setStatus(`Signed in as FID ${data.fid}`);
        if (data.fid && data.playerId) {
          onSuccess?.({ fid: data.fid, playerId: data.playerId });
        }
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Sign-in failed.";
        setStatus(message);
        onError?.(message);
      } finally {
        setBusy(false);
      }
    },
    [onError, onSuccess]
  );

  return (
    <div className="farcaster-siwf">
      <div className="farcaster-siwf__native">
        <SignInButton
          onSuccess={({ message, signature, nonce, fid }) => {
            void completeSiwf({ message, signature, nonce, fid });
          }}
          onError={(error) => {
            const message = error?.message || "Farcaster sign-in cancelled.";
            setStatus(message);
            onError?.(message);
          }}
        />
      </div>
      <button
        type="button"
        className="sx-signin"
        disabled={busy}
        onClick={(event) => {
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
        Sign in
      </button>
      {busy && <p className="sx-muted">Connecting…</p>}
      {!busy && status && <p className="sx-muted">{status}</p>}
      {isAuthenticated && profile?.fid != null && !status && (
        <p className="sx-muted">Farcaster FID {profile.fid}</p>
      )}
    </div>
  );
}
