"use client";

import { FormEvent, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Logo from "@/components/Logo";

interface OnboardingModalProps {
  open: boolean;
  saving: boolean;
  error?: string;
  defaultName?: string;
  defaultEmail?: string;
  onSubmit: (data: { name: string; email?: string }) => void;
  onChangeWallet?: () => void;
}

export default function OnboardingModal({
  open,
  saving,
  error,
  defaultName = "",
  defaultEmail = "",
  onSubmit,
  onChangeWallet,
}: OnboardingModalProps) {
  const [name, setName] = useState(defaultName);
  const [email, setEmail] = useState(defaultEmail);

  useEffect(() => {
    if (!open) return;
    setName(defaultName);
    setEmail(defaultEmail);
  }, [open, defaultName, defaultEmail]);

  if (!open) return null;

  const isValid = name.trim().length >= 1;

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!isValid || saving) return;
    onSubmit({
      name: name.trim(),
      email: email.trim() || undefined,
    });
  }

  const modal = (
    <div className="player-modal-backdrop">
      <div
        className="player-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="player-modal-title"
      >
        <Logo variant="login" />
        <p className="player-modal-subtitle">Welcome to ArcadeX</p>
        <h2 id="player-modal-title" className="player-modal-title">
          Set up your profile
        </h2>
        <p className="player-modal-hint">
          Your name appears on leaderboards across all games.
        </p>

        <form onSubmit={handleSubmit} className="player-modal-form">
          <label className="form-label" htmlFor="player-name">
            Player name
          </label>
          <input
            id="player-name"
            className={`form-input${error ? " input-error" : ""}`}
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. PixelPro"
            maxLength={20}
            autoFocus
            autoComplete="nickname"
            disabled={saving}
          />

          <label className="form-label" htmlFor="player-email">
            Email <span className="form-label-optional">(optional)</span>
          </label>
          <input
            id="player-email"
            className="form-input"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
            disabled={saving}
          />

          {error && <p className="error-msg">{error}</p>}

          <button
            type="submit"
            className="player-modal-submit"
            disabled={saving || !isValid}
          >
            {saving ? "Saving..." : "Continue"}
          </button>

          {onChangeWallet ? (
            <button
              type="button"
              className="network-switch-back"
              disabled={saving}
              onClick={onChangeWallet}
            >
              Choose a different network / wallet
            </button>
          ) : null}
        </form>
      </div>
    </div>
  );

  return typeof document !== "undefined"
    ? createPortal(modal, document.body)
    : modal;
}
