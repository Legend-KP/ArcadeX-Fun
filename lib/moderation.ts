/** Reject text the social layer will not store. */
const BLOCKED = [
  "kill yourself",
  "kys",
  "nigger",
  "nigga",
  "faggot",
  "retard",
];

export class ModerationError extends Error {
  constructor(message = "That text isn't allowed.") {
    super(message);
    this.name = "ModerationError";
  }
}

export function moderationFailure(err: unknown): string | null {
  return err instanceof ModerationError ? err.message : null;
}

export function screenText(raw: string): string {
  const text = raw.replace(/\s+/g, " ").trim();
  if (!text) throw new ModerationError("Write something first.");
  const folded = text.toLowerCase();
  if (folded.includes("javascript:")) {
    throw new ModerationError("That text isn't allowed.");
  }
  for (const word of BLOCKED) {
    if (folded.includes(word)) {
      throw new ModerationError("That text isn't allowed.");
    }
  }
  return text;
}
