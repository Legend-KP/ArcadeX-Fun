"use client";

import { useEffect, useState } from "react";

type Hit = {
  fid: number;
  name: string;
  handle: string | null;
  pfpUrl: string | null;
};

type Props = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  label: string;
};

export default function PlayerSuggestInput({ value, onChange, placeholder, label }: Props) {
  const [hits, setHits] = useState<Hit[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const q = value.trim();

  useEffect(() => {
    if (!q) {
      setHits([]);
      setOpen(false);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const timer = window.setTimeout(() => {
      fetch(`/api/social/player-search?q=${encodeURIComponent(q)}`, {
        cache: "no-store",
        credentials: "same-origin",
      })
        .then(async (res) => {
          const data = (await res.json()) as { players?: Hit[] };
          if (!res.ok) throw new Error("search failed");
          if (cancelled) return;
          const players = data.players ?? [];
          setHits(players);
          setOpen(players.length > 0);
        })
        .catch(() => {
          if (cancelled) return;
          setHits([]);
          setOpen(false);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 180);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [q]);

  function choose(hit: Hit) {
    const handle = hit.handle?.replace(/^@/, "").trim();
    onChange(handle || String(hit.fid));
    setOpen(false);
  }

  return (
    <div className="player-suggest">
      <label>
        {label}
        <input
          value={value}
          placeholder={placeholder}
          autoComplete="off"
          onChange={(event) => {
            onChange(event.target.value);
            setOpen(true);
          }}
          onFocus={() => {
            if (hits.length > 0) setOpen(true);
          }}
        />
      </label>
      {loading && q && <span className="player-suggest__status">Searching…</span>}
      {open && hits.length > 0 && (
        <ul className="player-suggest__list" role="listbox">
          {hits.map((hit) => (
            <li key={hit.fid}>
              <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(hit)}
              >
                {hit.pfpUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={hit.pfpUrl} alt="" />
                ) : (
                  <span>{hit.name.charAt(0).toUpperCase()}</span>
                )}
                <p>
                  <strong>{hit.name}</strong>
                  {hit.handle && <small>{hit.handle}</small>}
                </p>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
