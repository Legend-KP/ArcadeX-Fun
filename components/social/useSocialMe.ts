"use client";

import { useEffect, useState } from "react";
import {
  isSocialProfileReady,
  type SocialMe,
} from "@/components/farcaster/social-me";

export function useSocialMe() {
  const [me, setMe] = useState<SocialMe | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/farcaster/me")
      .then(async (res) => {
        if (cancelled) return;
        if (res.status === 401) {
          setMe(null);
          return;
        }
        const data = (await res.json()) as SocialMe;
        setMe(res.ok ? data : null);
      })
      .catch(() => {
        if (!cancelled) setMe(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { me, loading, ready: isSocialProfileReady(me) };
}
