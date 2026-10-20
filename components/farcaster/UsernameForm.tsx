"use client";

import { useState } from "react";

type Props = {
  onDone: () => void;
};

export default function UsernameForm({ onDone }: Props) {
  const [username, setUsername] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(value: string) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/farcaster/username", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: value }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error || "Could not save username.");
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save username.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="sx-card">
      <div className="sx-card__head">
        <span className="sx-ico" aria-hidden>
          <svg viewBox="0 0 24 24" width="22" height="22">
            <circle cx="12" cy="12" r="7.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
            <path d="M9.2 12h5.6M12 9.2v5.6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </span>
        <h2>ArcadeX username</h2>
      </div>
      <p className="sx-muted">
        Optional. This handle is only for ArcadeX search. It is separate from
        your Farcaster name.
      </p>
      <div className="sx-row">
        <input
          placeholder="your_handle"
          value={username}
          onChange={(e) => setUsername(e.target.value.toLowerCase())}
        />
        <button
          type="button"
          onClick={() => void submit(username)}
          disabled={busy || username.length < 3}
        >
          Save
        </button>
        <button
          type="button"
          className="sx-ghost"
          onClick={() => void submit("")}
          disabled={busy}
        >
          Skip
        </button>
      </div>
      {error && <p className="sx-error">{error}</p>}
    </section>
  );
}
