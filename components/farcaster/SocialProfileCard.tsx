"use client";

type Props = {
  displayName?: string | null;
  fname?: string | null;
  username?: string | null;
  fid?: number | null;
  pfpUrl?: string | null;
  custody?: string | null;
  recovery?: string | null;
  email?: string | null;
  emailVerified?: boolean;
  custodyChanged?: boolean;
};

function short(value: string): string {
  if (value.length < 16) return value;
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

export default function SocialProfileCard({
  displayName,
  fname,
  username,
  fid,
  pfpUrl,
  custody,
  recovery,
  email,
  emailVerified,
  custodyChanged,
}: Props) {
  const title = displayName || fname || username || (fid ? `FID ${fid}` : "Player");
  const initial = title.charAt(0).toUpperCase();

  return (
    <article className="sx-card">
      <div className="sx-profile">
        {pfpUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={pfpUrl} alt="" />
        ) : (
          <div className="sx-avatar" aria-hidden>
            {initial}
          </div>
        )}
        <div>
          <h2>{title}</h2>
          <p className="sx-meta">
            {username ? `@${username}` : "No ArcadeX username"}
            {fname ? ` · Farcaster @${fname}` : ""}
            {fid ? ` · FID ${fid}` : ""}
          </p>
        </div>
      </div>

      <div className="sx-kv">
        {email && (
          <div>
            <span>Email</span>
            <code>
              {email}
              {emailVerified ? " · verified" : " · not verified"}
            </code>
          </div>
        )}
        {custody && (
          <div>
            <span>Custody</span>
            <code title={custody}>{short(custody)}</code>
          </div>
        )}
        {recovery && (
          <div>
            <span>Recovery</span>
            <code title={recovery}>{short(recovery)}</code>
          </div>
        )}
      </div>

      {custodyChanged && (
        <p className="sx-warn">
          This FID&apos;s custody address changed on Optimism. Sign in again
          with the new custody wallet. Recovery is done in the Farcaster app,
          not inside ArcadeX.
        </p>
      )}

      {(custody || recovery) && (
        <p className="sx-muted" style={{ marginTop: 12 }}>
          Custody is the wallet that owns the FID. Recovery can move it if
          that wallet is lost. ArcadeX does not hold either key.
        </p>
      )}
    </article>
  );
}
