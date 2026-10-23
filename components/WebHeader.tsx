"use client";

import Logo from "@/components/Logo";
import ProfileDropdown from "@/components/ProfileDropdown";
import SparkBatteryBar from "@/components/SparkBatteryBar";
import type { ReactNode } from "react";

interface WebHeaderProps {
  profileName?: string;
  profileImage?: string | null;
  post?: ReactNode;
}

export default function WebHeader({
  profileName,
  profileImage,
  post,
}: WebHeaderProps) {
  return (
    <header className="web-header">
      <div
        className={`web-header__inner${post ? "" : " web-header__inner--plain"}`}
      >
        <div className="web-header__brand">
          <Logo variant="header" />
        </div>

        {post}

        <div className="web-header__actions">
          <SparkBatteryBar />
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
