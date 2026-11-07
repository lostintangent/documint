/**
 * Comment thread resolution: re-attach threads against the current document
 * snapshot using quote/context-based scoring on top of the document-layer
 * anchor primitives.
 *
 * The strategy is two-pass:
 *   1. Exact-quote pass — find every container where the persisted quote
 *      appears verbatim. Context (prefix/suffix matches) breaks ties.
 *   2. Context-only pass — when no verbatim quote exists, treat prefix and
 *      suffix as the anchor and estimate the missing edge from the prior
 *      quote length.
 *
 * Identical copies (the quote with its whole saved context, more than once)
 * tie, and only the caller's tiebreak settles them: a prior match, or the
 * saved `occurrence` that counts copies in document order.
 *
 * Comments owns the policy: scoring weights, similarity heuristics, and when
 * a tie is too close to call. The substrate (search and capture) lives in
 * `src/document/query/anchors/text.ts`.
 */

import {
  captureTextAnchor,
  collectTextAnchorCandidates,
  DEFAULT_ANCHOR_KIND,
  type AnchorContainer,
  type AnchorMatch,
  type TextAnchor,
} from "../query/anchors/text";
import type { CommentResolution, CommentThread } from "./types";

// --- Scoring weights ---

// Exact-quote candidates are already strong signals (the quoted text appears
// verbatim), so context only acts as a tiebreaker. Repair-mode candidates
// have no exact quote to anchor them, so matching prefix/suffix carries more
// weight and length similarity / shared character overlap break ties between
// fuzzy locations.
const EXACT_CONTEXT_MATCH_SCORE = 48;
const CONTEXT_REPAIR_MATCH_SCORE = 64;
const MAX_LENGTH_SIMILARITY_SCORE = 32;

// Cap on the per-candidate character-prefix/suffix comparison. Comparing
// long quotes against many candidates inside a paragraph with repeated text
// (e.g. a header that appears every few lines) is otherwise O(C·M·Q); the
// cap bounds the tail. 64 is comfortably larger than the surrounding
// `CONTEXT_WINDOW` of 24, so it never cuts inside text the prefix/suffix
// fingerprint already covered.
const MAX_SIMILARITY_COMPARE_LENGTH = 64;

type AnchorMatchCandidate = {
  container: AnchorContainer;
  endOffset: number;
  score: number;
  startOffset: number;
};

// --- Public API ---

// Resolve a thread against the current snapshot's anchor containers. Returns
// `null` when the thread is stale (no candidate) or ambiguous (a tied top
// score the tiebreak doesn't settle). The tiebreak is either where the thread
// resolved last time, which picks the equal candidate and keeps threads stable
// across snapshots that introduce duplicate matches (e.g. a heading repeated by
// a copy/paste), or a saved occurrence, which picks a copy by position. An
// occurrence only counts copies, so it can't pick a candidate whose saved
// context no longer matches.
export function resolveCommentThread(
  thread: CommentThread,
  containers: AnchorContainer[],
  tiebreak: AnchorMatch | number | null = null,
): CommentResolution | null {
  const { anchor } = thread;
  const anchorKind = anchor.kind ?? DEFAULT_ANCHOR_KIND;
  const candidateContainers = containers.filter(
    (container) => container.containerKind === anchorKind,
  );
  const exactCandidates = collectExactQuoteCandidates(thread, candidateContainers);

  if (exactCandidates.length > 0) {
    const copyScore =
      (anchor.prefix ? EXACT_CONTEXT_MATCH_SCORE : 0) +
      (anchor.suffix ? EXACT_CONTEXT_MATCH_SCORE : 0);

    return finalizeResolution(exactCandidates, tiebreak, copyScore);
  }

  const contextCandidates = collectContextResolutionCandidates(thread, candidateContainers);

  return contextCandidates.length > 0
    ? finalizeResolution(contextCandidates, tiebreak, null)
    : null;
}

// --- Candidate collection ---

function collectExactQuoteCandidates(thread: CommentThread, containers: AnchorContainer[]) {
  const candidates: AnchorMatchCandidate[] = [];
  const quote = thread.quote;

  if (quote.length === 0) {
    return candidates;
  }

  for (const container of containers) {
    // Copies can overlap, as "eses" does twice in "Yeseses", so the search
    // steps one character at a time.
    for (
      let startOffset = container.text.indexOf(quote);
      startOffset !== -1;
      startOffset = container.text.indexOf(quote, startOffset + 1)
    ) {
      candidates.push({
        container,
        endOffset: startOffset + quote.length,
        score: scoreContextMatch(
          container.text,
          thread.anchor,
          startOffset,
          startOffset + quote.length,
          EXACT_CONTEXT_MATCH_SCORE,
        ),
        startOffset,
      });
    }
  }

  candidates.sort((left, right) => right.score - left.score);

  return candidates;
}

// Context repair candidates need either both context edges or enough of the
// old quote surviving at the candidate's edges to trust a one-sided match.
function collectContextResolutionCandidates(thread: CommentThread, containers: AnchorContainer[]) {
  const candidates: AnchorMatchCandidate[] = [];
  const originalLength = thread.quote.length;
  const hasBothContextEdges = Boolean(thread.anchor.prefix && thread.anchor.suffix);
  const minimumOneSidedSimilarity = Math.max(
    2,
    Math.ceil(Math.min(originalLength, MAX_SIMILARITY_COMPARE_LENGTH) / 2),
  );

  for (const { container, endOffset, startOffset } of collectTextAnchorCandidates(
    containers,
    thread.anchor,
    { estimatedLength: originalLength },
  )) {
    const sharedQuoteEdges = countSharedEdgeCharacters(
      thread.quote,
      container.text.slice(startOffset, endOffset),
    );

    if (!hasBothContextEdges && sharedQuoteEdges < minimumOneSidedSimilarity) {
      continue;
    }

    candidates.push({
      container,
      endOffset,
      score:
        scoreContextMatch(
          container.text,
          thread.anchor,
          startOffset,
          endOffset,
          CONTEXT_REPAIR_MATCH_SCORE,
        ) +
        Math.max(
          0,
          MAX_LENGTH_SIMILARITY_SCORE - Math.abs(originalLength - (endOffset - startOffset)),
        ) +
        sharedQuoteEdges,
      startOffset,
    });
  }

  candidates.sort((left, right) => right.score - left.score);

  return candidates;
}

// --- Resolution finalization ---

// Candidates arrive sorted by score, and stably, so tied candidates stay in
// document order. A tie at `copyScore` (every saved context edge matches) is a
// tie among copies, and the winner reports its position among them.
function finalizeResolution(
  candidates: AnchorMatchCandidate[],
  tiebreak: AnchorMatch | number | null,
  copyScore: number | null,
): CommentResolution | null {
  const tied = collectTiedCandidates(candidates);
  const copies = tied && tied[0]!.score === copyScore ? tied : null;
  const winner = !tied
    ? candidates[0]!
    : typeof tiebreak === "number"
      ? (copies?.[tiebreak - 1] ?? null)
      : tiebreak && tied.find((candidate) => isCandidateAt(candidate, tiebreak));

  if (!winner) {
    return null;
  }

  const { container, endOffset, startOffset } = winner;

  return {
    ...captureTextAnchor(container, startOffset, endOffset),
    match: {
      containerKind: container.containerKind,
      containerPath: container.path,
      endOffset,
      startOffset,
    },
    ...(copies && { occurrence: copies.indexOf(winner) + 1 }),
  };
}

// The candidates sharing the top score, or `null` when the leader is unique.
function collectTiedCandidates(candidates: AnchorMatchCandidate[]) {
  const top = candidates[0]!.score;

  return candidates[1]?.score === top
    ? candidates.filter((candidate) => candidate.score === top)
    : null;
}

function isCandidateAt(candidate: AnchorMatchCandidate, match: AnchorMatch) {
  return (
    candidate.container.path === match.containerPath &&
    candidate.startOffset === match.startOffset &&
    candidate.endOffset === match.endOffset
  );
}

// --- Scoring ---

function scoreContextMatch(
  text: string,
  { prefix, suffix }: TextAnchor,
  startOffset: number,
  endOffset: number,
  weight: number,
) {
  return (
    (prefix && text.endsWith(prefix, startOffset) ? weight : 0) +
    (suffix && text.startsWith(suffix, endOffset) ? weight : 0)
  );
}

// Count the leading plus trailing characters two strings share, each side
// capped at `MAX_SIMILARITY_COMPARE_LENGTH`. Comment-specific similarity
// metric for accepting and tiebreaking fuzzy match candidates.
function countSharedEdgeCharacters(left: string, right: string): number {
  const limit = Math.min(MAX_SIMILARITY_COMPARE_LENGTH, left.length, right.length);
  let prefix = 0;
  let suffix = 0;

  while (prefix < limit && left[prefix] === right[prefix]) {
    prefix += 1;
  }

  while (suffix < limit && left[left.length - 1 - suffix] === right[right.length - 1 - suffix]) {
    suffix += 1;
  }

  return prefix + suffix;
}
