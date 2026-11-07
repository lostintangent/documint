/**
 * Anchor algebra: the content-addressable position vocabulary used across the
 * codebase.
 *
 * Comments, presence targets, and selection rebase across document snapshots
 * all need to express "this position in the document, identified by its
 * surrounding text" — durably, so a position can be re-found after edits,
 * parses, and reformats.
 *
 * This module owns the primitives those consumers share:
 *   - Vocabulary: text anchors plus thin indirect anchors such as comment
 *     thread anchors, and the container/match types used by the text-anchor
 *     algebra.
 *   - Discovery: enumerate the text containers an anchor can attach to.
 *   - Construction: capture a content-addressable anchor and quote around a range.
 *   - Search: enumerate substring matches and prefix/suffix ranges.
 *
 * Consumers layer their own scoring, uniqueness, or affinity policy on top of
 * these primitives. This module never picks a winner — it returns candidates.
 */

import type { Block, Document } from "../../model/types";
import { visitDocument } from "../visit";

// --- Anchor kinds ---

// The closed set of container families that anchors can attach to. `text`
// covers paragraphs and headings; `code` covers fenced code blocks;
// `tableCell` covers individual cells.
const ANCHOR_KINDS = ["text", "code", "tableCell"] as const;

type AnchorKind = (typeof ANCHOR_KINDS)[number];
const anchorKindSet = new Set<string>(ANCHOR_KINDS);

const anchorKindByBlockType: Partial<Record<Block["type"], AnchorKind>> = {
  code: "code",
  heading: "text",
  paragraph: "text",
};

const tableCellAnchorKind = "tableCell" satisfies AnchorKind;

// The implicit kind for a `TextAnchor` with no `kind` set. Keeping a default
// lets the common case stay out of the persisted payload entirely.
export const DEFAULT_ANCHOR_KIND: AnchorKind = "text";

export function isAnchorKind(value: unknown): value is AnchorKind {
  return typeof value === "string" && anchorKindSet.has(value);
}

// Returns `undefined` when the kind matches the default. Used during anchor
// construction so persisted payloads omit the redundant common case.
export function normalizeAnchorKind(kind: AnchorKind | undefined): AnchorKind | undefined {
  return kind === DEFAULT_ANCHOR_KIND ? undefined : kind;
}

// Map a block-node `type` to its `AnchorKind`, or `null` when the block
// can't host anchored content (lists, dividers, directives, etc.). Single
// source of truth for the closed mapping — used during semantic container
// discovery and by editor-side adapters that bridge editor path text back
// into the algebra.
export function anchorKindForBlockType(blockType: Block["type"]): AnchorKind | null {
  return anchorKindByBlockType[blockType] ?? null;
}

// --- Anchor types ---
//
// Substrate-level vocabulary. `TextAnchor` is the content-addressable form
// every consumer composes their own policy around. The indirect forms layered
// on top — e.g. `CommentThreadAnchor` from `src/document/comments` — live in
// their owning domains so the substrate stays free of domain identifiers.

// A content-addressable text position descriptor. `prefix` and `suffix` are short
// snapshots of the surrounding text; together they let a consumer re-find
// the anchored span after the document changes. `kind` constrains the search
// to a container family; an absent `kind` means `DEFAULT_ANCHOR_KIND`.
export type TextAnchor = {
  kind?: AnchorKind;
  prefix?: string;
  suffix?: string;
};

// A text anchor plus the quoted text it addresses, captured together.
export type TextAnchorCapture = {
  anchor: TextAnchor;
  quote: string;
};

// A text container an anchor can attach to. `path` is the structural container
// path in the current snapshot.
export type AnchorContainer = {
  containerKind: AnchorKind;
  path: string;
  text: string;
};

// Where a `TextAnchor` resolved to in a current `Document` snapshot.
export type AnchorMatch = {
  containerPath: string;
  containerKind: AnchorKind;
  startOffset: number;
  endOffset: number;
};

// A raw location where a `TextAnchor` could attach inside a specific
// container. Consumers decide whether candidates are unique enough, need
// scoring, or should be rejected as ambiguous.
type TextAnchorCandidate = {
  container: AnchorContainer;
  endOffset: number;
  startOffset: number;
};

// --- Container discovery ---

// Walk `document` in document order and return every text container an anchor
// can attach to: heading and paragraph blocks (kind `text`), code blocks
// (kind `code`), and individual table cells (kind `tableCell`).
// Container text comes from the committed document's cached `plainText` fields
// so anchoring and future content search share one canonical semantic text
// projection instead of re-projecting inline children ad hoc.
export function listAnchorContainers(document: Document): AnchorContainer[] {
  const containers: AnchorContainer[] = [];

  visitDocument(document, {
    enterBlock(block, context) {
      const anchorKind = anchorKindForBlockType(block.type);

      if (anchorKind) {
        containers.push({
          containerKind: anchorKind,
          path: context.path,
          text: block.plainText,
        });
      }
    },
    enterTableCell(cell, context) {
      containers.push({
        containerKind: tableCellAnchorKind,
        path: context.path,
        text: cell.plainText,
      });
    },
  });

  return containers;
}

// --- Anchor construction ---

// Record a (container, range) pair by content: the anchor fingerprints up to
// `CONTEXT_WINDOW` characters on each side, and the quote is the addressed
// text, kept for later drift detection. Offsets clamp to the container text.
export function captureTextAnchor(
  container: Pick<AnchorContainer, "containerKind" | "text">,
  startOffset: number,
  endOffset: number,
): TextAnchorCapture {
  const { text } = container;
  const start = clamp(startOffset, 0, text.length);
  const end = clamp(endOffset, start, text.length);

  return {
    anchor: {
      kind: normalizeAnchorKind(container.containerKind),
      prefix: text.slice(Math.max(0, start - CONTEXT_WINDOW), start) || undefined,
      suffix: text.slice(end, end + CONTEXT_WINDOW) || undefined,
    },
    quote: text.slice(start, end),
  };
}

// --- Search primitives ---

// The start of each non-overlapping copy of `query` in `text`, left to right,
// so a periodic context such as "abab" in "ababab" matches once. Comment quote
// search steps one character at a time instead, since overlapping quotes are
// distinct copies. Returns `[]` for an empty query so callers can treat "no
// signal" descriptors uniformly.
function findOccurrences(text: string, query: string): number[] {
  if (query.length === 0) {
    return [];
  }

  const occurrences: number[] = [];
  let searchIndex = 0;

  while (searchIndex <= text.length) {
    const matchIndex = text.indexOf(query, searchIndex);

    if (matchIndex === -1) {
      break;
    }

    occurrences.push(matchIndex);
    // `query.length >= 1` is guaranteed by the early return above, so no
    // `Math.max(1, …)` floor is needed to make progress on each iteration.
    searchIndex = matchIndex + query.length;
  }

  return occurrences;
}

// For every `prefix` occurrence in `text`, find the earliest `suffix` start
// at or after the prefix's end. Returns `(startOffset, endOffset)` pairs
// where `startOffset` is the position immediately after the prefix and
// `endOffset` is where the suffix begins (so `endOffset >= startOffset`).
// Returns `[]` if either context is empty. Consumers apply their own
// scoring, uniqueness, or affinity policy on top of the raw candidate list.
function findContextRanges(
  text: string,
  prefix: string,
  suffix: string,
): Array<{ startOffset: number; endOffset: number }> {
  if (prefix.length === 0 || suffix.length === 0) {
    return [];
  }

  const ranges: Array<{ startOffset: number; endOffset: number }> = [];

  for (const prefixIndex of findOccurrences(text, prefix)) {
    const startOffset = prefixIndex + prefix.length;
    const suffixIndex = text.indexOf(suffix, startOffset);

    if (suffixIndex !== -1) {
      ranges.push({ startOffset, endOffset: suffixIndex });
    }
  }

  return ranges;
}

// Enumerate the raw ranges described by a text anchor inside one container.
// With both prefix and suffix, the range is the text between them. With one
// side only, the known edge is exact and the missing edge is estimated from
// `estimatedLength` so consumers that track spans can keep producing ranges.
// Point-like consumers can omit `estimatedLength` and use the collapsed range.
export function enumerateTextAnchorRanges(
  text: string,
  anchor: TextAnchor,
  options: { estimatedLength?: number } = {},
): Array<{ startOffset: number; endOffset: number }> {
  const prefix = anchor.prefix ?? "";
  const suffix = anchor.suffix ?? "";
  const estimatedLength = Math.max(0, options.estimatedLength ?? 0);

  if (prefix.length > 0 && suffix.length > 0) {
    return findContextRanges(text, prefix, suffix);
  }

  if (prefix.length > 0) {
    return findOccurrences(text, prefix).map((prefixIndex) => {
      const startOffset = prefixIndex + prefix.length;
      return {
        endOffset: clamp(startOffset + estimatedLength, startOffset, text.length),
        startOffset,
      };
    });
  }

  if (suffix.length > 0) {
    return findOccurrences(text, suffix).map((suffixIndex) => {
      const endOffset = suffixIndex;
      return {
        endOffset,
        startOffset: clamp(endOffset - estimatedLength, 0, endOffset),
      };
    });
  }

  return [];
}

// Collect raw anchor candidates across a set of containers. This is the
// shared substrate for consumers like presence (unique candidate required)
// and comments (score/repair candidates with comment-specific policy).
export function collectTextAnchorCandidates(
  containers: readonly AnchorContainer[],
  anchor: TextAnchor,
  options: { estimatedLength?: number } = {},
): TextAnchorCandidate[] {
  const anchorKind = anchor.kind ?? DEFAULT_ANCHOR_KIND;
  const candidates: TextAnchorCandidate[] = [];

  for (const container of containers) {
    if (container.containerKind !== anchorKind) {
      continue;
    }

    for (const range of enumerateTextAnchorRanges(container.text, anchor, options)) {
      candidates.push({
        container,
        endOffset: range.endOffset,
        startOffset: range.startOffset,
      });
    }
  }

  return candidates;
}

// --- Utilities ---

const CONTEXT_WINDOW = 24;

// Clamp `value` to `[min, max]`. Exported because every consumer of the
// anchor algebra needs to clamp offsets against text-length bounds.
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
