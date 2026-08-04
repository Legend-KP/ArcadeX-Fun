/** Server-side stub — keeps sails-js out of the Cloudflare Worker bundle. */
export function getFnNamePrefix(_payload: string): string {
  throw new Error("Vara sails codec is not available in this deployment.");
}

export function getServiceNamePrefix(_payload: string): string {
  throw new Error("Vara sails codec is not available in this deployment.");
}
