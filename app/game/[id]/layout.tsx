import type { Metadata } from "next";
import { fetchGameFromServer } from "@/lib/firestore-server";
import { absoluteUrl } from "@/lib/public-url";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const game = await fetchGameFromServer(id).catch(() => null);
  const title = game?.name ? `${game.name} on ArcadeX` : "ArcadeX";
  const description = game?.name
    ? `Play ${game.name} on ArcadeX`
    : "Play on ArcadeX";
  const url = absoluteUrl(`/game/${id}`);
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: { title, description, url },
  };
}

export default function GameLayout({ children }: { children: React.ReactNode }) {
  return children;
}
