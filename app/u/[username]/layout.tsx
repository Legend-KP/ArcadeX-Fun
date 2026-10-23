import type { Metadata } from "next";
import { fetchSocialProfileByUsername } from "@/lib/farcaster/social-db";
import { absoluteUrl } from "@/lib/public-url";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ username: string }>;
}): Promise<Metadata> {
  const { username } = await params;
  const handle = decodeURIComponent(username).replace(/^@/, "");
  const profile = await fetchSocialProfileByUsername(handle).catch(() => null);
  const name = profile?.displayName || profile?.username || handle;
  const title = `${name} on ArcadeX`;
  const description = `Open ${name}'s ArcadeX profile`;
  const url = absoluteUrl(`/u/${encodeURIComponent(handle)}`);
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: { title, description, url },
  };
}

export default function UsernameLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
