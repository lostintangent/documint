/**
 * Anchor algebra: the content-addressable position vocabulary used across the
 * codebase.
 *
 * Comments, presence cursors, and selection rebase across document snapshots
 * all need to express "this position in the document, identified by its
 * surrounding text" — durably, so a position can be re-found after edits,
 * parses, and reformats.
 *
 * This module owns the primitives those consumers share:
 *   - Vocabulary: the `Anchor` descriptor and its container/match/resolution types.
 *   - Discovery: enumerate the text containers an anchor can attach to.
 *   - Construction: capture a content-addressable fingerprint around a range.
 *   - Search: enumerate substring matches, prefix/suffix ranges, and verify
 *     that fingerprints align at known positions.
 *
 * Consumers layer their own scoring, uniqueness, or affinity policy on top of
 * these primitives. This module never picks a winner — it returns candidates.
 */

import { extractPlainTextFromInlineNodes } from "./document";
import type { Document } from "./types";
import { visitDocument } from "./visit";

// --- Anchor kinds ---

// The closed set of container families that anchors can attach to. `text`
// covers paragraphs and headings; `code` covers fenced code blocks;
// `tableCell` covers individual cells.
const ANCHOR_KINDS = ["text", "code", "tableCell"] as const;

type AnchorKind = (typeof ANCHOR_KINDS)[number];

// The implicit kind for an `Anchor` with no `kind` set. Keeping a default
// lets the common case stay out of the persisted payload entirely.
export const DEFAULT_ANCHOR_KIND: AnchorKind = "text";

export function isAnchorKind(value: unknown): value is AnchorKind {
  return value === "text" || value === "code" || value === "tableCell";
}

// Returns `undefined` when the kind matches the default. Used during anchor
// construction so persisted payloads omit the redundant common case.
export function normalizeAnchorKind(kind: AnchorKind | undefined): AnchorKind | undefined {
  return kind === DEFAULT_ANCHOR_KIND ? undefined : kind;
}

// Map a block-node `type` to its `AnchorKind`, or `null` when the block
// can't host anchored content (lists, dividers, directives, etc.). Single
// source of truth for the closed mapping — used during semantic container
// discovery and by editor-side adapters that bridge runtime regions back
// into the algebra.
export function anchorKindForBlockType(blockType: string): AnchorKind | null {
  switch (blockType) {
    case "heading":
    case "paragraph":
      return "text";
    case "code":
      return "code";
    default:
      return null;
  }
}

// --- Anchor types ---

// A content-addressable position descriptor. `prefix` and `suffix` are short
// snapshots of the surrounding text; together they let a consumer re-find
// the anchored span after the document changes. `kind` constrains the search
// to a container family; an absent `kind` means `DEFAULT_ANCHOR_KIND`.
export type Anchor = {
  kind?: AnchorKind;
  prefix?: string;
  suffix?: string;
};

// A text region an anchor can attach to. `id` is the underlying block or
// table-cell id. `containerOrdinal` is the position among containers in
// document order — used to disambiguate identical-text containers.
export type AnchorContainer = {
  containerKind: AnchorKind;
  containerOrdinal: number;
  id: string;
  text: string;
};

// Where an `Anchor` resolved to in a current `Document` snapshot.
export type AnchorMatch = {
  containerId: string;
  containerKind: AnchorKind;
  containerOrdinal: number;
  startOffset: number;
  endOffset: number;
};

// --- Resolution result ---

// Lifecycle of an anchor reattachment attempt.
//   matched   - The anchor's exact context still appears in the snapshot.
//   repaired  - The anchor drifted; resolution recovered a best-fit location.
//   ambiguous - Multiple equally-strong locations exist; no safe pick.
//   stale    - The anchor can no longer be located.
export type AnchorResolutionStatus = "ambiguous" | "matched" | "repaired" | "stale";

// Generic resolution result. Consumers pick their own `TRepair` payload to
// carry whatever they want to refresh on the anchored entity (e.g. a comment's
// quoted text). `repair` is non-null whenever `match` is non-null; together
// they describe both *where* the anchor lives now and *how* its persisted
// representation should be updated to keep tracking the same span cleanly.
export type AnchorResolution<TRepair> = {
  match: AnchorMatch | null;
  repair: TRepair | null;
  status: AnchorResolutionStatus;
};

// --- Container discovery ---

// Walk `document` in document order and return every text container an anchor
// can attach to: heading and paragraph blocks (kind `text`), code blocks
// (kind `code`), and individual table cells (kind `tableCell`).
// `containerOrdinal` reflects the global order across all kinds, so it stays
// stable even when consumers filter by kind.
export function listAnchorContainers(document: Document): AnchorContainer[] {
  const containers: AnchorContainer[] = [];

  visitDocument(document, {
    enterBlock(block) {
      switch (block.type) {
        case "heading":
        case "paragraph":
          containers.push({
            containerKind: "text",
            containerOrdinal: containers.length,
            id: block.id,
            text: extractPlainTextFromInlineNodes(block.children),
          });
          break;

        case "code":
          containers.push({
            containerKind: "code",
            containerOrdinal: containers.length,
            id: block.id,
            text: block.source,
          });
          break;
      }
    },
    enterTableCell(cell) {
      containers.push({
        containerKind: "tableCell",
        containerOrdinal: containers.length,
        id: cell.id,
        text: extractPlainTextFromInlineNodes(cell.children),
      });
    },
  });

  return containers;
}

// --- Anchor construction ---

// Capture prefix and suffix windows surrounding a `(startOffset, endOffset)`
// range as a content-addressable fingerprint. Each side is up to
// `CONTEXT_WINDOW` characters of the surrounding text. The foundational
// primitive behind `createAnchorFromContainer`; consumers that need a
// fingerprint for raw text without an `AnchorContainer` in hand call this
// directly.
export function captureContextWindows(
  text: string,
  startOffset: number,
  endOffset: number,
): { prefix: string; suffix: string } {
  return {
    prefix: text.slice(Math.max(0, startOffset - CONTEXT_WINDOW), startOffset),
    suffix: text.slice(endOffset, Math.min(text.length, endOffset + CONTEXT_WINDOW)),
  };
}

// Build an `Anchor` from a (container, range) pair, capturing up to
// `CONTEXT_WINDOW` characters of surrounding text as the prefix/suffix
// fingerprint. Used by any consumer that wants to record a position by
// content rather than by index.
export function createAnchorFromContainer(
  container: AnchorContainer,
  startOffset: number,
  endOffset: number,
): Anchor {
  const normalizedStart = clamp(startOffset, 0, container.text.length);
  const normalizedEnd = clamp(endOffset, normalizedStart, container.text.length);
  const { prefix, suffix } = captureContextWindows(container.text, normalizedStart, normalizedEnd);

  return {
    kind: normalizeAnchorKind(container.containerKind),
    prefix: prefix || undefined,
    suffix: suffix || undefined,
  };
}

// Slice the text span addressed by a (container, range) pair. Pairs with
// `createAnchorFromContainer` to capture both the descriptor and the original
// quoted text for later drift detection.
export function extractQuoteFromContainer(
  container: AnchorContainer,
  startOffset: number,
  endOffset: number,
): string {
  const normalizedStart = clamp(startOffset, 0, container.text.length);
  const normalizedEnd = clamp(endOffset, normalizedStart, container.text.length);

  return container.text.slice(normalizedStart, normalizedEnd);
}

// --- Search primitives ---

// Enumerate every starting index of `query` in `text`. Substrate for
// content-addressable anchor resolution: thread reattachment, selection
// rebase, presence cursor placement. Returns `[]` for an empty query so
// callers can treat "no signal" descriptors uniformly.
export function findOccurrences(text: string, query: string): number[] {
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
    searchIndex = matchIndex + Math.max(1, query.length);
  }

  return occurrences;
}

// For every `prefix` occurrence in `text`, find the earliest `suffix` start
// at or after the prefix's end. Returns `(startOffset, endOffset)` pairs
// where `startOffset` is the position immediately after the prefix and
// `endOffset` is where the suffix begins (so `endOffset >= startOffset`).
// Returns `[]` if either context is empty. Consumers apply their own
// scoring, uniqueness, or affinity policy on top of the raw candidate list.
export function findContextRanges(
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

// Verify that `prefix` ends exactly at `position` in `text`. Returns `false`
// for an absent prefix so consumers can score against optional descriptors
// uniformly. The inverse of the prefix capture done by `captureContextWindows`.
export function prefixMatchesAt(
  text: string,
  prefix: string | undefined,
  position: number,
): boolean {
  if (!prefix) {
    return false;
  }

  return text.slice(Math.max(0, position - prefix.length), position) === prefix;
}

// Verify that `suffix` starts exactly at `position` in `text`. Returns `false`
// for an absent suffix so consumers can score against optional descriptors
// uniformly. The inverse of the suffix capture done by `captureContextWindows`.
export function suffixMatchesAt(
  text: string,
  suffix: string | undefined,
  position: number,
): boolean {
  if (!suffix) {
    return false;
  }

  return text.slice(position, position + suffix.length) === suffix;
}

// --- Utilities ---

const CONTEXT_WINDOW = 24;

// Clamp `value` to `[min, max]`. Exported because every consumer of the
// anchor algebra needs to clamp offsets against text-length bounds.
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
