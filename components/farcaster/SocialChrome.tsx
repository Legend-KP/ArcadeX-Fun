"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import Logo from "@/components/Logo";
import "./social.css";

export default function SocialChrome({ children }: { children: ReactNode }) {
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
