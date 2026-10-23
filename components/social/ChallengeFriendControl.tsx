"use client";

import { useState } from "react";
import { sendChallenge } from "@/lib/social-challenges-client";

type Props = {
  gameId: string;
  gameName: string;
  trigger?: "bar" | "menu";
};

export default function ChallengeFriendControl({
  gameId,
  gameName,
  trigger = "bar",
}: Props) {
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState("");
  const [expiryHours, setExpiryHours] = useState<24 | 72>(24);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!target.trim() || busy) return;
    setBusy(true);
    setError("");
    const message = await sendChallenge({
      target,
      gameId,
      gameName,
      expiryHours,
    });
    setBusy(false);
    if (message) {
      setError(message);
      return;
    }
    setSent(true);
    setTarget("");
  }

  return (
    <div className={`challenge-friend challenge-friend--${trigger}`}>
      <button
        type="button"
        className={
          trigger === "menu"
            ? "game-menu-btn game-menu-btn--challenge"
            : "challenge-friend__trigger"
        }
        aria-expanded={open}
        onClick={() => {
          setOpen((value) => !value);
          setSent(false);
        }}
      >
        {trigger === "menu" ? "Challenge" : "Challenge a friend"}
      </button>
      {open && (
        <form className="challenge-friend__panel" onSubmit={(event) => void submit(event)}>
          <p>Challenge a friend to this game</p>
          <label>
            Their username or FID
            <input
              value={target}
              onChange={(event) => setTarget(event.target.value)}
              placeholder="kushal or 1234"
            />
          </label>
          <div className="challenge-friend__hours">
            <label>
              <input
                type="radio"
                name={`${gameId}-expiry`}
                checked={expiryHours === 24}
                onChange={() => setExpiryHours(24)}
              />
              24h
            </label>
            <label>
              <input
                type="radio"
                name={`${gameId}-expiry`}
                checked={expiryHours === 72}
                onChange={() => setExpiryHours(72)}
              />
              72h
            </label>
          </div>
          <button type="submit" disabled={busy || !target.trim()}>
            {busy ? "Sending…" : "Send challenge"}
          </button>
          {sent && <p className="challenge-friend__ok">Challenge sent.</p>}
          {error && <p className="challenge-friend__err">{error}</p>}
        </form>
      )}
    </div>
  );
}
