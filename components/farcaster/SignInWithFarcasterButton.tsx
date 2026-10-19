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
      {busy && <p>Connecting…</p>}
      {!busy && status && <p>{status}</p>}
      {isAuthenticated && profile?.fid != null && !status && (
        <p>Farcaster FID {profile.fid}</p>
      )}
    </div>
  );
}
