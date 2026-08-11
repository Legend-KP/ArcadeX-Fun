/**
 * Deployment environment label for structured logs / metrics.
 * Prefer explicit DEPLOY_ENV; otherwise infer from Cloudflare / Next.
 */
export type DeployEnv = "production" | "preview" | "development";

export function getDeployEnv(): DeployEnv {
  const explicit = process.env.DEPLOY_ENV?.trim().toLowerCase();
  if (
    explicit === "production" ||
    explicit === "preview" ||
    explicit === "development"
  ) {
    return explicit;
  }

  if (process.env.NODE_ENV === "development") return "development";

  // Cloudflare Workers preview / Pages preview often set CF_PAGES_BRANCH
  // or a non-production WORKERS_CI_BRANCH.
  const branch =
    process.env.CF_PAGES_BRANCH?.trim() ||
    process.env.WORKERS_CI_BRANCH?.trim() ||
    "";
  if (branch && branch !== "main" && branch !== "master" && branch !== "production") {
    return "preview";
  }

  if (process.env.VERCEL_ENV === "preview") return "preview";
  if (process.env.VERCEL_ENV === "development") return "development";

  return process.env.NODE_ENV === "production" ? "production" : "development";
}
