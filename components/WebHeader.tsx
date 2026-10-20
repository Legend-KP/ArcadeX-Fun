"use client";

import Logo from "@/components/Logo";
import ProfileDropdown from "@/components/ProfileDropdown";
import SparkBatteryBar from "@/components/SparkBatteryBar";
import { usePlayerProfile } from "@/components/PlayerProfileProvider";
import { truncateAddress } from "@/lib/player-identity";
import type { ReactNode } from "react";

interface WebHeaderProps {
  profileName?: string;
  profileImage?: string | null;
  post?: ReactNode;
}

function WalletIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden width="16" height="16">
      <rect x="3" y="6" width="18" height="13" rx="3" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M3 10h18" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="16.5" cy="14.5" r="1" fill="currentColor" />
    </svg>
  );
}

export default function WebHeader({
  profileName,
  profileImage,
  post,
}: WebHeaderProps) {
  const { isAuthenticated, walletAddress, openConnect } = usePlayerProfile();
  const walletLabel =
    isAuthenticated && walletAddress
      ? truncateAddress(walletAddress)
      : "Connect Wallet";

  return (
    <header className="web-header">
      <div className="web-header__inner">
        <div className="web-header__brand">
          <Logo variant="header" />
        </div>

        {post}

        <div className="web-header__actions">
          <SparkBatteryBar />
          <button
            type="button"
            className="connect-btn connect-btn--wallet"
            onClick={() => openConnect()}
          >
            <WalletIcon />
            <span className="connect-btn__label">{walletLabel}</span>
          </button>
          <ProfileDropdown
            menuOnly
            label={profileName}
            avatarUrl={profileImage}
          />
        </div>
      </div>
    </header>
  );
}
