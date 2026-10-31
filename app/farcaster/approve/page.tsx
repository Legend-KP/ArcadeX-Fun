"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";

function isApprovalToken(value: string): boolean {
  return /^0x[0-9a-fA-F]{8,80}$/.test(value);
}

function FarcasterApprove() {
  const token = useSearchParams().get("token") ?? "";
  if (!isApprovalToken(token)) {
    return (
      <main className="farcaster-approve">
        <h1>This approval link is not valid.</h1>
      </main>
    );
  }

  return (
    <main className="farcaster-approve">
      <h1>Approve ArcadeX in Farcaster</h1>
      <p>
        Tap the button. The Farcaster app opens and shows the approval there.
        Confirm it in the app. ArcadeX never sees your custody key.
      </p>
      <a className="farcaster-approve__open" href={`farcaster://signed-key-request?token=${token}`}>
        Open approval in Farcaster
      </a>
    </main>
  );
}

export default function FarcasterApprovePage() {
  return (
    <Suspense
      fallback={
        <main className="farcaster-approve">
          <p>Loading the approval…</p>
        </main>
      }
    >
      <FarcasterApprove />
    </Suspense>
  );
}
