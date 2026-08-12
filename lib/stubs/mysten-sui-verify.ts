/**
 * Server stub for `@mysten/sui/verify` — re-exports the lite verifier.
 * Keeps the real Mysten package out of the Cloudflare Worker graph.
 */
export { isValidPersonalMessageSignature } from "@/lib/sui-verify-lite";
