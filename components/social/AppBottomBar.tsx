"use client";

import Link from "next/link";

export type BottomTab = "play" | "challenges" | "activity" | "profile";

type Props = {
  active: BottomTab;
  onSelect: (tab: Exclude<BottomTab, "profile">) => void;
};

const TABS: { id: BottomTab; label: string; href?: string }[] = [
  { id: "play", label: "Play" },
  { id: "challenges", label: "Challenges" },
  { id: "activity", label: "Activity" },
  { id: "profile", label: "Profile", href: "/profile" },
];

export default function AppBottomBar({ active, onSelect }: Props) {
  return (
    <nav className="app-bottom-bar" aria-label="Primary">
      {TABS.map((tab) =>
        tab.href ? (
          <Link
            key={tab.id}
            href={tab.href}
            className={active === tab.id ? "is-on" : undefined}
            aria-current={active === tab.id ? "page" : undefined}
          >
            {tab.label}
          </Link>
        ) : (
          <button
            key={tab.id}
            type="button"
            className={active === tab.id ? "is-on" : undefined}
            aria-current={active === tab.id ? "page" : undefined}
            onClick={() => onSelect(tab.id as Exclude<BottomTab, "profile">)}
          >
            {tab.label}
          </button>
        )
      )}
    </nav>
  );
}
