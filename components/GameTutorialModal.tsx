"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";

interface GameTutorialModalProps {
  open: boolean;
  imageUrl: string;
  gameName: string;
  onDismiss: () => void;
}

export default function GameTutorialModal({
  open,
  imageUrl,
  gameName,
  onDismiss,
}: GameTutorialModalProps) {
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDismiss();
    };

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onDismiss]);

  if (!open || typeof document === "undefined") return null;

  const modal = (
    <div
      className="game-tutorial-backdrop"
      role="presentation"
      onClick={onDismiss}
    >
      <div
        className="game-tutorial"
        role="dialog"
        aria-modal="true"
        aria-labelledby="game-tutorial-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="game-tutorial__body">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imageUrl}
            alt={`How to play ${gameName}`}
            className="game-tutorial__image"
          />
        </div>
        <button
          type="button"
          className="game-tutorial__cta"
          onClick={onDismiss}
        >
          Let&apos;s Go
        </button>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
