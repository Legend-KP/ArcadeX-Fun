"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import {
  pendingChallengeCount,
  readChallenges,
  subscribeSocialChallenges,
  viewerKeys,
} from "@/lib/social-challenges";
import { socialIdentity, type SocialMe } from "@/components/farcaster/social-me";

export type SocialSection =
  | "home"
  | "games"
  | "leaderboards"
  | "notifications"
  | "profile";

type Props = {
  active: SocialSection;
  me: SocialMe | null;
  ready: boolean;
  onSelect: (section: Exclude<SocialSection, "profile">) => void;
  onExplore?: () => void;
  search?: string;
  onSearchChange?: (value: string) => void;
};

function IconHome() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden width="20" height="20">
      <path
        d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5.2v-5.2H10.2V21H5a1 1 0 0 1-1-1v-9.5Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconGames() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden width="20" height="20">
      <rect x="3" y="6" width="18" height="12" rx="4" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M8 12h3M9.5 10.5v3M16 11h.01M18 13h.01" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function IconBoards() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden width="20" height="20">
      <path d="M6 20V10M12 20V4M18 20v-7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function IconBell() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden width="20" height="20">
      <path
        d="M6 16.5h12l-1.2-1.8V10a4.8 4.8 0 1 0-9.6 0v4.7L6 16.5Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path d="M10 16.5a2 2 0 0 0 4 0" fill="none" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

function IconProfile() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden width="20" height="20">
      <circle cx="12" cy="8" r="3.2" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M5.5 19.5a6.5 6.5 0 0 1 13 0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

const ITEMS: {
  id: Exclude<SocialSection, "profile">;
  label: string;
  icon: () => ReturnType<typeof IconHome>;
}[] = [
  { id: "home", label: "Home", icon: IconHome },
  { id: "games", label: "Games", icon: IconGames },
  { id: "leaderboards", label: "Leaderboards", icon: IconBoards },
  { id: "notifications", label: "Notifications", icon: IconBell },
];

export default function SocialSidebar({
  active,
  me,
  ready,
  onSelect,
  onExplore,
  search = "",
  onSearchChange,
}: Props) {
  const challenges = useSyncExternalStore(
    subscribeSocialChallenges,
    readChallenges,
    readChallenges
  );
  const identity = me ? socialIdentity(me) : null;
  const name = identity?.displayName || "Player";
  const badge = pendingChallengeCount(
    challenges,
    viewerKeys([
      identity?.fid,
      identity?.username,
      identity?.displayName,
      identity?.playerId,
    ])
  );
  const profileHref = ready ? "/profile" : "/social";

  return (
    <div className="board-nav">
      {onSearchChange && (
        <label className="board-nav__search">
          <span aria-hidden>⌕</span>
          <input
            type="search"
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search games, posts, players..."
            aria-label="Search games, posts, and players"
          />
        </label>
      )}
      <nav aria-label="Social">
        {ITEMS.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              className={active === item.id ? "is-on" : undefined}
              aria-current={active === item.id ? "page" : undefined}
              onClick={() => onSelect(item.id)}
            >
              <Icon />
              <span>{item.label}</span>
              {item.id === "notifications" && badge > 0 && (
                <em>{badge}</em>
              )}
            </button>
          );
        })}
        <Link
          href={profileHref}
          className={active === "profile" ? "is-on" : undefined}
          aria-current={active === "profile" ? "page" : undefined}
        >
          <IconProfile />
          <span>Profile</span>
        </Link>
      </nav>

      <div className="board-promo">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/social/social-promo-card.jpg" alt="" />
        {onExplore ? (
          <button type="button" onClick={onExplore}>
            Explore Games <span aria-hidden>→</span>
          </button>
        ) : (
          <Link href="/?section=games">
            Explore Games <span aria-hidden>→</span>
          </Link>
        )}
      </div>
      <span className="sr-only">{name}</span>
    </div>
  );
}
