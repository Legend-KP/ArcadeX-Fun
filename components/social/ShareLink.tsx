"use client";

import { useState } from "react";
import { absoluteUrl } from "@/lib/public-url";

type Props = {
  path: string;
  title?: string;
  text?: string;
};

export default function ShareLink({ path, title = "ArcadeX", text }: Props) {
  const [note, setNote] = useState("");
  const url = absoluteUrl(path);

  async function onShare() {
    setNote("");
    try {
      if (typeof navigator.share === "function") {
        await navigator.share({ title, text: text || title, url });
        setNote(url);
        return;
      }
      await navigator.clipboard.writeText(url);
      setNote("Link copied");
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      try {
        await navigator.clipboard.writeText(url);
        setNote("Link copied");
      } catch {
        setNote("Copy this link");
      }
    }
  }

  return (
    <div className="share-link">
      <button type="button" onClick={() => void onShare()}>
        Share
      </button>
      <a href={path}>{url}</a>
      {note && <span>{note}</span>}
    </div>
  );
}
