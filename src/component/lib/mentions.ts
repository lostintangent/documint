// Trigger-token tokenization shared between the comment renderer (which
// pills "@Jane Doe") and the comment-changed event (which reports the IDs
// of mentioned users). One scanner, one set of matching rules — so a label
// that renders as a pill always extracts to its underlying ID, and vice
// versa. Items contribute an opaque `id` so the extractor can map labels
// back to host-domain identifiers (user IDs for "@", anything else for
// future triggers); the renderer simply ignores it.
import type { CompletionSource } from "../overlays/leaves/core/LeafInput";

type Segment =
  | { kind: "text"; text: string }
  | { kind: "token"; trigger: string; label: string; id?: string };

// Split text into runs of plain content and trigger-prefixed tokens that
// match a completion source label. Labels within a source are matched
// longest-first so "Jane Doe" wins over "Jane" when both are present.
// A trigger only counts at the start of input or after whitespace, so
// "email@alice" doesn't get treated as a mention.
export function tokenizeTriggers(
  value: string,
  sources: CompletionSource[] | undefined,
): Segment[] {
  if (!sources?.length || !sources.some((source) => value.includes(source.trigger))) {
    return [{ kind: "text", text: value }];
  }

  const itemsByTrigger = new Map<string, CompletionSource["items"]>();
  for (const source of sources) {
    const sorted = [...source.items].sort((a, b) => b.label.length - a.label.length);
    itemsByTrigger.set(source.trigger, sorted);
  }

  const segments: Segment[] = [];
  let cursor = 0;
  let textStart = 0;

  while (cursor < value.length) {
    const char = value[cursor];
    const items = itemsByTrigger.get(char);
    const isTriggerCandidate =
      items !== undefined && (cursor === 0 || isTokenBoundary(value[cursor - 1]));

    if (isTriggerCandidate) {
      const item = items.find((candidate) => value.startsWith(candidate.label, cursor + 1));
      if (item) {
        if (cursor > textStart) {
          segments.push({ kind: "text", text: value.slice(textStart, cursor) });
        }
        segments.push({ kind: "token", trigger: char, label: item.label, id: item.id });
        cursor += 1 + item.label.length;
        textStart = cursor;
        continue;
      }
    }

    cursor += 1;
  }

  if (textStart < value.length) {
    segments.push({ kind: "text", text: value.slice(textStart) });
  }

  return segments;
}

// Pull the IDs of users mentioned in `body`, deduped and in first-occurrence
// order. The roster is whatever was wired into the "@" completion source —
// so this stays consistent with what the renderer pills as a mention.
export function extractMentionedUserIds(
  body: string,
  mentionSources: CompletionSource[] | undefined,
): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();

  for (const segment of tokenizeTriggers(body, mentionSources)) {
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

function isTokenBoundary(char: string | undefined): boolean {
  return char === undefined || char === " " || char === "\n" || char === "\t";
}
