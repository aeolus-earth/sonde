import type { User } from "@supabase/supabase-js";

const VOYAGER = "Voyager";

function readMetadataString(meta: Record<string, unknown>, key: string): string | null {
  const v = meta[key];
  return typeof v === "string" ? v : null;
}

/** First whitespace-delimited token from OAuth `full_name` / `name`, or null if unusable. */
export function getWelcomeFirstName(user: User | null): string | null {
  if (!user) return null;
  const meta = user.user_metadata as Record<string, unknown> | undefined;
  if (!meta) return null;
  const raw =
    readMetadataString(meta, "full_name") ?? readMetadataString(meta, "name");
  if (!raw) return null;
  const first = raw.trim().split(/\s+/)[0];
  return first.length > 0 ? first : null;
}

/** First name for the welcome line, or `"Voyager"` when missing. */
export function getWelcomeGreeting(user: User | null): string {
  return getWelcomeFirstName(user) ?? VOYAGER;
}
