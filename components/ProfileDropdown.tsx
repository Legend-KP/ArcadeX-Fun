"use client";

import { useEffect, useRef, useState } from "react";
import { truncateAddress } from "@/lib/player-identity";
import { usePlayerProfile } from "@/components/PlayerProfileProvider";

export default function ProfileDropdown() {
  const { playerName, walletAddress, ecosystem, logout, openConnect, isAuthenticated } =
    usePlayerProfile();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(event: MouseEvent) {
      if (!ref.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  if (!isAuthenticated) {
    return (
      <button type="button" className="connect-btn" onClick={openConnect}>
        Connect Wallet
      </button>
    );
  }

  const displayName = playerName || "Player";
  const shortWallet = walletAddress ? truncateAddress(walletAddress) : "";
  const chainLabel =
    ecosystem === "starknet"
      ? "Starknet"
      : ecosystem === "sui"
        ? "Sui"
        : "EVM";

  return (
    <div className="profile-dropdown" ref={ref}>
      <button
        type="button"
        className="profile-trigger"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <span className="profile-avatar" aria-hidden>
          {displayName.charAt(0).toUpperCase()}
        </span>
        <span className="profile-trigger__chevron" aria-hidden>
          ▾
        </span>
      </button>

      {open && (
        <div className="profile-menu" role="menu">
          <div className="profile-menu__header">
            <p className="profile-menu__name">{displayName}</p>
            <p className="profile-menu__wallet">{shortWallet}</p>
            <p className="profile-menu__chain">{chainLabel}</p>
          </div>
          <button
            type="button"
            className="profile-menu__logout"
            role="menuitem"
            onClick={async () => {
              setOpen(false);
              await logout();
            }}
          >
            Log out
          </button>
        </div>
      )}
    </div>
  );
}
