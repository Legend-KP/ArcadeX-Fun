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

export type SocialSection = "home" | "games" | "notifications" | "profile";

type Props = {
  active: SocialSection;
  me: SocialMe | null;
  ready: boolean;
  onSelect: (section: Exclude<SocialSection, "profile">) => void;
};

function IconHome() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden width="22" height="22">
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
    <svg viewBox="0 0 24 24" aria-hidden width="22" height="22">
      <rect x="3" y="3" width="7.5" height="7.5" rx="2" fill="currentColor" />
      <rect x="13.5" y="3" width="7.5" height="7.5" rx="2" fill="currentColor" />
      <rect x="3" y="13.5" width="7.5" height="7.5" rx="2" fill="currentColor" />
      <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="2" fill="currentColor" />
    </svg>
  );
}

function IconBell() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden width="22" height="22">
      <path
        d="M6 16.5h12l-1.2-1.8V10a4.8 4.8 0 1 0-9.6 0v4.7L6 16.5Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M10 16.5a2 2 0 0 0 4 0"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      />
    </svg>
  );
}

export default function SocialSidebar({ active, me, ready, onSelect }: Props) {
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
    <nav className="soc-rail" aria-label="Social">
      <button
        type="button"
        className={`soc-rail__btn${active === "home" ? " is-on" : ""}`}
        aria-current={active === "home" ? "page" : undefined}
        aria-label="Home"
        onClick={() => onSelect("home")}
      >
        <IconHome />
      </button>
      <button
        type="button"
        className={`soc-rail__btn${active === "games" ? " is-on" : ""}`}
        aria-current={active === "games" ? "page" : undefined}
        aria-label="Games"
        onClick={() => onSelect("games")}
      >
        <IconGames />
      </button>
      <button
        type="button"
        className={`soc-rail__btn${active === "notifications" ? " is-on" : ""}`}
        aria-current={active === "notifications" ? "page" : undefined}
        aria-label={badge > 0 ? `Notifications, ${badge} challenges` : "Notifications"}
        onClick={() => onSelect("notifications")}
      >
        <IconBell />
        {badge > 0 && <span className="soc-rail__badge">{badge}</span>}
      </button>
      <span className="soc-rail__spacer" />
      <Link
        href={profileHref}
        className={`soc-rail__profile${active === "profile" ? " is-on" : ""}`}
        aria-label={ready ? `${name} profile` : "Sign in with Farcaster"}
        aria-current={active === "profile" ? "page" : undefined}
      >
        {identity?.pfpUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={identity.pfpUrl} alt="" />
        ) : (
          <span>{name.charAt(0).toUpperCase()}</span>
        )}
      </Link>
    </nav>
  );
}
