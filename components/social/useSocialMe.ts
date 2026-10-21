"use client";

import { useCallback, useEffect, useState } from "react";
import {
  isSocialProfileReady,
  type SocialMe,
} from "@/components/farcaster/social-me";

async function readMe(): Promise<SocialMe | null> {
  const res = await fetch("/api/farcaster/me", {
    cache: "no-store",
    credentials: "same-origin",
  });
  if (res.status === 401) return null;
  const data = (await res.json()) as SocialMe;
  return res.ok ? data : null;
}

/**
 * Session follows the cookie, the same way Farcaster keeps a signer until
 * Sign out. Back/forward must re-read that cookie instead of a cached 401.
 */
export function useSocialMe() {
  const [me, setMe] = useState<SocialMe | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const next = await readMe();
      setMe(next);
    } catch {
      // A failed request is not a logout. Keep the profile we already have.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    readMe()
      .then((next) => {
        if (!cancelled) setMe(next);
      })
      .catch(() => {
        if (!cancelled) setMe(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    function onPageShow(event: PageTransitionEvent) {
      if (event.persisted) void load();
    }

    window.addEventListener("pageshow", onPageShow);
    return () => {
      cancelled = true;
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [load]);

  return { me, loading, ready: isSocialProfileReady(me) };
}
