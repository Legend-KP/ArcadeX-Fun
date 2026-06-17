"use client";

import Logo from "@/components/Logo";
import ProfileDropdown from "@/components/ProfileDropdown";

interface WebHeaderProps {
  search: string;
  onSearchChange: (value: string) => void;
}

export default function WebHeader({ search, onSearchChange }: WebHeaderProps) {
  return (
    <header className="web-header">
      <div className="web-header__inner">
        <div className="web-header__brand">
          <Logo variant="header" />
        </div>

        <div className="web-header__search">
          <span className="web-header__search-icon" aria-hidden>
            ⌕
          </span>
          <input
            type="search"
            className="web-header__search-input"
            placeholder="Search games..."
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            aria-label="Search games"
          />
        </div>

        <div className="web-header__profile">
          <ProfileDropdown />
        </div>
      </div>
    </header>
  );
}
