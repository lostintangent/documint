// Mention-domain helpers: extracting the IDs of mentioned users from
// committed comment text. Tokenization is delegated to `completions.ts`
// (which owns trigger-token parsing) so the render and extract paths always
// use the same scanner and matching rules.
import { tokenizeTriggers } from "../completions/completions";
import type { CompletionSource } from "../completions/completions";

// Pull the IDs of users mentioned in `body`, deduped and in first-occurrence
// order. The roster is whatever was wired into the "@" completion source —
// so this stays consistent with what the renderer pills as a mention.
export function extractMentionedUserIds(
  body: string,
  completionSources: CompletionSource[] | undefined,
): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();

  for (const segment of tokenizeTriggers(body, completionSources)) {
    if (segment.kind !== "token" || segment.trigger !== "@" || !segment.id) {
      continue;
    }
    if (seen.has(segment.id)) {
      continue;
    }
    seen.add(segment.id);
    ids.push(segment.id);
  }

  return ids;
}
