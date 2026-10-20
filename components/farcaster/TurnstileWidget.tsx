"use client";

import { useEffect, useRef } from "react";

type Props = {
  onToken: (token: string) => void;
};

/**
 * Renders nothing until NEXT_PUBLIC_TURNSTILE_SITE_KEY is set.
 * Server checks run only when TURNSTILE_SECRET_KEY is set.
 */
export default function TurnstileWidget({ onToken }: Props) {
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim();
  const hostRef = useRef<HTMLDivElement>(null);
  const onTokenRef = useRef(onToken);
  onTokenRef.current = onToken;

  useEffect(() => {
    if (!siteKey || !hostRef.current) return;
    let widgetId: string | undefined;
    let cancelled = false;

    const existing = document.querySelector<HTMLScriptElement>(
      "script[data-turnstile]"
    );

    function render() {
      if (cancelled || !hostRef.current || !window.turnstile) return;
      widgetId = window.turnstile.render(hostRef.current, {
        sitekey: siteKey!,
        callback: (token) => onTokenRef.current(token),
      });
    }

    if (existing && window.turnstile) {
      render();
    } else if (!existing) {
      const script = document.createElement("script");
      script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js";
      script.async = true;
      script.dataset.turnstile = "1";
      script.onload = render;
      document.head.appendChild(script);
    } else {
      existing.addEventListener("load", render);
    }

    return () => {
      cancelled = true;
      if (widgetId && window.turnstile) {
        window.turnstile.remove(widgetId);
      }
    };
  }, [siteKey]);

  if (!siteKey) return null;
  return <div ref={hostRef} style={{ marginTop: 12 }} />;
}

declare global {
  interface Window {
    turnstile?: {
      render: (
        el: HTMLElement,
        opts: { sitekey: string; callback: (token: string) => void }
      ) => string;
      remove: (id: string) => void;
    };
  }
}
