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
 * Comments owns the policy: scoring weights, similarity heuristics, and how
 * `matched` vs `repaired` is decided. The substrate (search, capture,
 * verification) lives in `src/document/query/anchors/text.ts`.
 */

import {
  collectTextAnchorCandidates,
  createAnchorFromContainer,
  DEFAULT_ANCHOR_KIND,
  extractQuoteFromContainer,
  findOccurrences,
  listAnchorContainers,
  prefixMatchesAt,
  suffixMatchesAt,
  type AnchorContainer,
  type AnchorMatch,
  type TextAnchor,
} from "../query/anchors/text";
import type { Document } from "../model/types";
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

// Resolve a thread against the current snapshot. Pass `previousMatch` when the
// caller knows where the thread resolved last time — equal-score ties prefer
// the prior location, which keeps threads stable across snapshots that
// introduce duplicate matches (e.g. a heading repeated by a copy/paste).
export function resolveCommentThread(
  thread: CommentThread,
  snapshot: Document,
  previousMatch: AnchorMatch | null = null,
): CommentResolution {
  return resolveCommentThreadInContainers(thread, listAnchorContainers(snapshot), previousMatch);
}

export function resolveCommentThreadInContainers(
  thread: CommentThread,
  containers: AnchorContainer[],
  previousMatch: AnchorMatch | null = null,
): CommentResolution {
  const anchorKind = thread.anchor.kind ?? DEFAULT_ANCHOR_KIND;
  const candidateContainers = containers.filter(
    (container) => container.containerKind === anchorKind,
  );
  const exactCandidates = collectExactQuoteCandidates(thread, candidateContainers);

  if (exactCandidates.length > 0) {
    return finalizeResolution(thread, exactCandidates, null, previousMatch);
  }

  const contextCandidates = collectContextResolutionCandidates(thread, candidateContainers);

  if (contextCandidates.length > 0) {
    return finalizeResolution(thread, contextCandidates, "repaired", previousMatch);
  }

  return {
    match: null,
    repair: null,
    status: "stale",
  };
}

// --- Candidate collection ---

function collectExactQuoteCandidates(thread: CommentThread, containers: AnchorContainer[]) {
  const candidates: AnchorMatchCandidate[] = [];
  const quote = thread.quote;

  if (quote.length === 0) {
    return candidates;
  }

  for (const container of containers) {
    for (const startOffset of findOccurrences(container.text, quote)) {
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

function finalizeResolution(
  thread: CommentThread,
  candidates: AnchorMatchCandidate[],
  forceStatus: "repaired" | null,
  previousMatch: AnchorMatch | null,
): CommentResolution {
  const winner = pickWinningCandidate(candidates, previousMatch);

  // Callers only invoke `finalizeResolution` with a non-empty candidate list,
  // so a null winner means the leader is genuinely ambiguous — multiple equal
  // top scores, none of which match the prior location.
  if (!winner) {
    return {
      match: null,
      repair: null,
      status: "ambiguous",
    };
  }

  const repairedAnchor = createAnchorFromContainer(
    winner.container,
    winner.startOffset,
    winner.endOffset,
  );
  const repairedQuote = extractQuoteFromContainer(
    winner.container,
    winner.startOffset,
    winner.endOffset,
  );
  const status =
    forceStatus ??
    (repairedQuote === thread.quote &&
    (repairedAnchor.prefix ?? "") === (thread.anchor.prefix ?? "") &&
    (repairedAnchor.suffix ?? "") === (thread.anchor.suffix ?? "")
      ? "matched"
      : "repaired");

  return {
    match: toAnchorMatch(winner.container, winner.startOffset, winner.endOffset),
    repair: {
      anchor: repairedAnchor,
      quote: repairedQuote,
    },
    status,
  };
}

// Pick the highest-scoring candidate, falling back to `previousMatch` as the
// tiebreaker when the top score is shared. Returns `null` if the leader is
// genuinely ambiguous (multiple equal scores, none matching the prior
// location) or if there are no candidates at all.
function pickWinningCandidate(
  candidates: AnchorMatchCandidate[],
  previousMatch: AnchorMatch | null,
): AnchorMatchCandidate | null {
  const first = candidates[0]!;
  const second = candidates[1];

  if (!second || first.score !== second.score) {
    return first;
  }

  // Tie at the top: prefer the candidate that matches the previous match
  // exactly. Stability across snapshots is worth more than the tied score
  // since "the previous answer" carries information the score doesn't.
  if (previousMatch) {
    const tied = candidates.filter((candidate) => candidate.score === first.score);
    const priorMatch = tied.find(
      (candidate) =>
        candidate.container.path === previousMatch.containerPath &&
        candidate.startOffset === previousMatch.startOffset &&
        candidate.endOffset === previousMatch.endOffset,
    );

    if (priorMatch) {
      return priorMatch;
    }
  }

  return null;
}

function toAnchorMatch(
  container: AnchorContainer,
  startOffset: number,
  endOffset: number,
): AnchorMatch {
  return {
    containerPath: container.path,
    containerKind: container.containerKind,
    containerOrdinal: container.containerOrdinal,
    endOffset,
    startOffset,
  };
}

// --- Scoring ---

function scoreContextMatch(
  text: string,
  anchor: TextAnchor,
  startOffset: number,
  endOffset: number,
  weight: number,
) {
  return (
    (prefixMatchesAt(text, anchor.prefix, startOffset) ? weight : 0) +
    (suffixMatchesAt(text, anchor.suffix, endOffset) ? weight : 0)
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
