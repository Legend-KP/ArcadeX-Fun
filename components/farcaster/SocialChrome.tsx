"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import Logo from "@/components/Logo";
import "./social.css";

export default function SocialChrome({
  children,
  scene = false,
}: {
  children: ReactNode;
  scene?: boolean;
}) {
  if (scene) {
    return (
      <div className="sx sx--scene">
        <main className="sx-main sx-main--scene">{children}</main>
      </div>
    );
  }

  return (
    <div className="sx">
      <header className="sx-bar">
        <Link href="/" aria-label="ArcadeX home">
          <Logo variant="header" />
        </Link>
      </header>
      <main className="sx-main">{children}</main>
    </div>
  );
}
