"use client";

import { useCallback, useEffect, useState } from "react";
import {
  isSocialProfileReady,
  type SocialMe,
} from "@/components/farcaster/social-me";

const ME_TTL_MS = 20_000;
const PRESENCE_GAP_MS = 40_000;

let meCache: { at: number; value: SocialMe | null } | null = null;
let meInflight: Promise<SocialMe | null> | null = null;
let lastPresenceAt = 0;

async function readMe(fresh = false): Promise<SocialMe | null> {
  if (!fresh && meCache && Date.now() - meCache.at < ME_TTL_MS) {
    return meCache.value;
  }
  if (!fresh && meInflight) return meInflight;

  meInflight = (async () => {
    const res = await fetch("/api/farcaster/me", {
      cache: "no-store",
      credentials: "same-origin",
    });
    if (res.status === 401) return null;
    const data = (await res.json()) as SocialMe;
    return res.ok ? data : null;
  })().then((value) => {
    if (value?.fid) meCache = { at: Date.now(), value };
    return value;
  });

  try {
    return await meInflight;
  } finally {
    meInflight = null;
  }
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
      if (event.persisted) {
        meCache = null;
        void load();
      }
    }

    window.addEventListener("pageshow", onPageShow);
    return () => {
      cancelled = true;
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [load]);

  useEffect(() => {
    if (!me?.fid) return;
    let stop = false;
    const ping = () => {
      if (stop || document.visibilityState === "hidden") return;
      const now = Date.now();
      if (now - lastPresenceAt < PRESENCE_GAP_MS) return;
      lastPresenceAt = now;
      void fetch("/api/social/presence", {
        method: "POST",
        credentials: "same-origin",
      });
    };
    ping();
    const timer = window.setInterval(ping, 45_000);
    return () => {
      stop = true;
      window.clearInterval(timer);
    };
  }, [me?.fid]);

  return { me, loading, ready: isSocialProfileReady(me) };
}
