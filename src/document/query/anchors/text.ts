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
 *     thread anchors, and the container/match/resolution types used by the
 *     text-anchor algebra.
 *   - Discovery: enumerate the text containers an anchor can attach to.
 *   - Construction: capture a content-addressable fingerprint around a range.
 *   - Search: enumerate substring matches, prefix/suffix ranges, and verify
 *     that captured context aligns at known positions.
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
// discovery and by editor-side adapters that bridge runtime regions back
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

// A text region an anchor can attach to. `path` is the structural container
// path in the current snapshot. `containerOrdinal` is the position among
// containers in document order — used to disambiguate identical-text
// containers when content alone is tied.
export type AnchorContainer = {
  containerKind: AnchorKind;
  containerOrdinal: number;
  path: string;
  text: string;
};

// Where a `TextAnchor` resolved to in a current `Document` snapshot.
export type AnchorMatch = {
  containerPath: string;
  containerKind: AnchorKind;
  containerOrdinal: number;
  startOffset: number;
  endOffset: number;
};

// A raw location where a `TextAnchor` could attach inside a specific
// container. Consumers decide whether candidates are unique enough, need
// scoring, or should be rejected as ambiguous.
export type TextAnchorCandidate = {
  container: AnchorContainer;
  endOffset: number;
  startOffset: number;
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
// Container text comes from the committed document's cached `plainText` fields
// so anchoring and future content search share one canonical semantic text
// projection instead of re-projecting inline children ad hoc.
// `containerOrdinal` reflects the global order across all kinds, so it stays
// stable even when consumers filter by kind.
export function listAnchorContainers(document: Document): AnchorContainer[] {
  const containers: AnchorContainer[] = [];

  visitDocument(document, {
    enterBlock(block, context) {
      const anchorKind = anchorKindForBlockType(block.type);

      if (anchorKind) {
        containers.push({
          containerKind: anchorKind,
          containerOrdinal: containers.length,
          path: context.path,
          text: block.plainText,
        });
      }
    },
    enterTableCell(cell, context) {
      containers.push({
        containerKind: tableCellAnchorKind,
        containerOrdinal: containers.length,
        path: context.path,
        text: cell.plainText,
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
  container: Pick<AnchorContainer, "containerKind" | "text">,
  startOffset: number,
  endOffset: number,
): TextAnchor {
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
  container: Pick<AnchorContainer, "text">,
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
// rebase, presence target placement. Returns `[]` for an empty query so
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

// Enumerate the raw ranges described by a text anchor inside one container.
// With both prefix and suffix, the range is the text between them. With one
// side only, the known edge is exact and the missing edge is estimated from
// `estimatedLength` so consumers that track spans can keep producing ranges.
// Point-like consumers can omit `estimatedLength` and use the collapsed range.
export function enumerateTextAnchorRanges(
  target: AnchorContainer | string,
  anchor: TextAnchor,
  options: { estimatedLength?: number } = {},
): Array<{ startOffset: number; endOffset: number }> {
  const prefix = anchor.prefix ?? "";
  const suffix = anchor.suffix ?? "";
  const estimatedLength = Math.max(0, options.estimatedLength ?? 0);
  const text = typeof target === "string" ? target : target.text;

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

    for (const range of enumerateTextAnchorRanges(container, anchor, options)) {
      candidates.push({
        container,
        endOffset: range.endOffset,
        startOffset: range.startOffset,
      });
    }
  }

  return candidates;
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
