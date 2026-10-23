/** Public site origin used in links other people open. */
export function publicAppOrigin(): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (configured) {
    const withProtocol = configured.startsWith("http")
      ? configured
      : `https://${configured}`;
    return withProtocol.replace(/\/$/, "");
  }
  if (typeof window !== "undefined") return window.location.origin;
  return "";
}

export function absoluteUrl(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  const origin = publicAppOrigin();
  return origin ? `${origin}${normalized}` : normalized;
}
