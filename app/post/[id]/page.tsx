import type { Metadata } from "next";
import CastPermalink from "@/components/social/CastPermalink";
import { absoluteUrl } from "@/lib/public-url";
import { getTextPost } from "@/lib/social-board";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const post = await getTextPost(id).catch(() => null);
  const title = post ? `${post.authorName} on ArcadeX` : "ArcadeX";
  const description = post?.body || "A cast on ArcadeX";
  const url = absoluteUrl(`/post/${id}`);
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: { title, description, url },
  };
}

export default async function PostPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <CastPermalink id={id} />;
}
