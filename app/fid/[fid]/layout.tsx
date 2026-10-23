import type { Metadata } from "next";
import { fetchSocialProfileByFid } from "@/lib/farcaster/social-db";
import { absoluteUrl } from "@/lib/public-url";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ fid: string }>;
}): Promise<Metadata> {
  const { fid } = await params;
  const id = Number(fid);
  const profile =
    Number.isFinite(id) && id > 0
      ? await fetchSocialProfileByFid(id).catch(() => null)
      : null;
  const name = profile?.displayName || profile?.username || `FID ${fid}`;
  const title = `${name} on ArcadeX`;
  const description = `Open ${name}'s ArcadeX profile`;
  const url = absoluteUrl(`/fid/${fid}`);
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: { title, description, url },
  };
}

export default function FidLayout({ children }: { children: React.ReactNode }) {
  return children;
}
