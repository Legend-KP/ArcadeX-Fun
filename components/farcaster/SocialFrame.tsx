"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import Logo from "@/components/Logo";
import "./social.css";

type Props = {
  name: string;
  pfpUrl?: string | null;
  children: ReactNode;
};

export default function SocialFrame({ name, pfpUrl, children }: Props) {
  const initial = name.charAt(0).toUpperCase() || "?";

  return (
    <div className="sx-app">
      <header className="sx-top">
        <Link href="/social" aria-label="ArcadeX home">
          <Logo variant="header" />
        </Link>
        <Link
          href="/social/profile"
          className="sx-pfp"
          aria-label={`${name} profile`}
        >
          {pfpUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={pfpUrl} alt="" />
          ) : (
            <span aria-hidden>{initial}</span>
          )}
        </Link>
      </header>
      <main className="sx-app-main">{children}</main>
    </div>
  );
}
