/**
 * Chat mention parsing helpers.
 *
 * Extracted from `components/chat/chat-input.tsx` so they're directly
 * unit-testable. These functions handle user input that gets fed into
 * a regex — a bug here (e.g. `escapeRegExp` missing a metacharacter)
 * could cause ReDoS or let a crafted mention token bypass deduplication
 * and appear twice in the submitted message.
 */

import type { MentionRef } from "@/types/chat";

/** Escape regex metacharacters so `value` can be used as a literal in RegExp. */
export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** True if `text` already contains `@id` as a whole-token mention. */
export function mentionTokenExists(text: string, id: string): boolean {
  return new RegExp(`(^|\\s)@${escapeRegExp(id)}(?=\\s|$)`).test(text);
}

/** Two MentionRefs refer to the same record across id, type, and program. */
export function sameMention(a: MentionRef, b: MentionRef): boolean {
  return a.id === b.id && a.type === b.type && a.program === b.program;
}

/** Remove duplicates by (id, type, program), preserving first-seen order. */
export function dedupeMentions(items: MentionRef[]): MentionRef[] {
  return items.filter(
    (item, index, arr) => arr.findIndex((other) => sameMention(other, item)) === index,
  );
}
