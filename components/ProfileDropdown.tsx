"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { truncateAddress } from "@/lib/player-identity";
import { getConnectedChainLabel } from "@/lib/wallet-ecosystems";
import { usePlayerProfile } from "@/components/PlayerProfileProvider";

type Props = {
  menuOnly?: boolean;
  label?: string;
  avatarUrl?: string | null;
};

export default function ProfileDropdown({
  menuOnly = false,
  label,
  avatarUrl,
}: Props) {
  const {
    playerName,
    walletAddress,
    ecosystem,
    chainId,
    logout,
    openConnect,
    isAuthenticated,
  } = usePlayerProfile();
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

  const displayName = label || playerName || "Player";
  const shortWallet = walletAddress ? truncateAddress(walletAddress) : "";
  const chainLabel = getConnectedChainLabel(ecosystem, chainId);

  if (!isAuthenticated && !menuOnly) {
    return (
      <button type="button" className="connect-btn" onClick={() => openConnect()}>
        Connect Wallet
      </button>
    );
  }

  return (
    <div className="profile-dropdown" ref={ref}>
      <button
        type="button"
        className="profile-trigger"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        {avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="profile-avatar" src={avatarUrl} alt="" />
        ) : (
          <span className="profile-avatar" aria-hidden>
            {displayName.charAt(0).toUpperCase()}
          </span>
        )}
        <span className="profile-trigger__chevron" aria-hidden>
          ▾
        </span>
      </button>

      {open && (
        <div className="profile-menu" role="menu">
          <div className="profile-menu__header">
            <p className="profile-menu__name">{displayName}</p>
            {shortWallet ? (
              <p className="profile-menu__wallet">{shortWallet}</p>
            ) : (
              <p className="profile-menu__wallet">No external wallet connected</p>
            )}
            {isAuthenticated && <p className="profile-menu__chain">{chainLabel}</p>}
          </div>
          {!isAuthenticated && (
            <button
              type="button"
              className="profile-menu__link"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                openConnect();
              }}
            >
              Connect Wallet
            </button>
          )}
          <Link href="/profile" className="profile-menu__link" role="menuitem">
            Profile
          </Link>
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
