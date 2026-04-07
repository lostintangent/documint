import type { Document } from "@/document";
import { extractPlainTextFromInlineNodes, visitDocument } from "@/document";
import type {
  Comment,
  CommentAnchor,
  CommentAnchorMatch,
  CommentAppendixPayload,
  CommentRepairResult,
  CommentTargetContainer,
  CommentThread,
} from "./types";

export const COMMENT_APPENDIX_DIRECTIVE_NAME = "documint-comments";

const CONTEXT_WINDOW = 24;

export function listCommentTargetContainers(snapshot: Document): CommentTargetContainer[] {
  const containers: CommentTargetContainer[] = [];

  visitDocument(snapshot, {
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
            text: block.value,
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

export function createCommentAnchorFromContainer(
  container: CommentTargetContainer,
  startOffset: number,
  endOffset: number,
): CommentAnchor {
  const normalizedStart = clamp(startOffset, 0, container.text.length);
  const normalizedEnd = clamp(endOffset, normalizedStart, container.text.length);

  return {
    kind:
      container.containerKind === "code" || container.containerKind === "tableCell"
        ? container.containerKind
        : undefined,
    prefix:
      container.text.slice(Math.max(0, normalizedStart - CONTEXT_WINDOW), normalizedStart) || undefined,
    suffix: container.text.slice(normalizedEnd, normalizedEnd + CONTEXT_WINDOW) || undefined,
  };
}

export function createCommentQuoteFromContainer(
  container: CommentTargetContainer,
  startOffset: number,
  endOffset: number,
) {
  const normalizedStart = clamp(startOffset, 0, container.text.length);
  const normalizedEnd = clamp(endOffset, normalizedStart, container.text.length);

  return container.text.slice(normalizedStart, normalizedEnd);
}

export function repairCommentThread(
  thread: CommentThread,
  snapshot: Document,
): CommentRepairResult {
  const containers = listCommentTargetContainers(snapshot).filter(
    (container) => container.containerKind === resolveCommentAnchorKind(thread.anchor),
  );
  const exactCandidates = collectExactQuoteCandidates(thread, containers);

  if (exactCandidates.length > 0) {
    return finalizeRepair(thread, exactCandidates);
  }

  const contextCandidates = collectContextRepairCandidates(thread, containers);

  if (contextCandidates.length > 0) {
    return finalizeRepair(thread, contextCandidates, {
      diagnostics: ["Anchor quote was repaired from surrounding text context."],
      forceStatus: "repaired",
    });
  }

  return {
    diagnostics: ["Anchor quote no longer matches semantic content."],
    match: null,
    repairedThread: null,
    status: "stale",
    strategy: null,
  };
}

export function serializeCommentAppendixPayload(threads: CommentThread[]) {
  const payload: CommentAppendixPayload = {
    threads,
  };

  return `${JSON.stringify(payload, null, 2)}\n`;
}

export function parseCommentAppendixPayload(value: string): CommentThread[] {
  try {
    const parsed = JSON.parse(value) as Partial<CommentAppendixPayload>;

    if (!Array.isArray(parsed.threads)) {
      return [];
    }

    return parsed.threads.flatMap((candidate) => {
      const normalized = normalizeCommentThread(candidate);

      return normalized ? [normalized] : [];
    });
  } catch {
    return [];
  }
}

export function createCommentThread(options: {
  anchor: CommentAnchor;
  body: string;
  createdAt?: string;
  quote: string;
}) {
  const createdAt = options.createdAt ?? new Date().toISOString();
  const comment = createComment({
    body: options.body,
    updatedAt: createdAt,
  });

  return {
    quote: options.quote,
    anchor: options.anchor,
    comments: [comment],
  } satisfies CommentThread;
}

export function createComment(options: {
  body: string;
  updatedAt?: string;
}) {
  const updatedAt = options.updatedAt ?? new Date().toISOString();

  return {
    body: options.body,
    updatedAt,
  } satisfies Comment;
}

export function updateCommentThreadStatus(
  thread: CommentThread,
  status: "open" | "resolved",
  changedAt = new Date().toISOString(),
) {
  if (isResolvedCommentThread(thread) === (status === "resolved")) {
    return thread;
  }

  return {
    ...thread,
    resolvedAt: status === "resolved" ? changedAt : undefined,
  };
}

export function appendThreadComment(
  thread: CommentThread,
  options: {
    body: string;
    updatedAt?: string;
  },
) {
  const comment = createComment(options);

  return {
    ...thread,
    comments: [...thread.comments, comment],
  } satisfies CommentThread;
}

export function editThreadComment(
  thread: CommentThread,
  commentIndex: number,
  body: string,
  changedAt = new Date().toISOString(),
) {
  const normalizedBody = body.trim();

  if (normalizedBody.length === 0) {
    return thread;
  }

  let didChange = false;
  const comments = thread.comments.map((comment, index) => {
    if (index !== commentIndex || comment.body === normalizedBody) {
      return comment;
    }

    didChange = true;

    return {
      ...comment,
      body: normalizedBody,
      updatedAt: changedAt,
    };
  });

  if (!didChange) {
    return thread;
  }

  return {
    ...thread,
    comments,
  } satisfies CommentThread;
}

export function deleteThreadComment(thread: CommentThread, commentIndex: number) {
  const comments = thread.comments.filter((_, index) => index !== commentIndex);

  if (comments.length === thread.comments.length) {
    return thread;
  }

  if (comments.length === 0) {
    return null;
  }

  return {
    ...thread,
    comments,
  } satisfies CommentThread;
}

export function deleteCommentThread(threads: CommentThread[], threadIndex: number) {
  return threads.filter((_, index) => index !== threadIndex);
}

export function isResolvedCommentThread(thread: CommentThread) {
  return thread.resolvedAt != null;
}

export function countResolvedCommentThreads(threads: CommentThread[]) {
  return threads.filter((thread) => isResolvedCommentThread(thread)).length;
}

export function getCommentThreadUpdatedAt(thread: CommentThread) {
  return thread.comments.reduce(
    (latest, comment) => (comment.updatedAt > latest ? comment.updatedAt : latest),
    thread.comments[0]?.updatedAt ?? "",
  );
}

export function haveSameCommentThreads(left: CommentThread[], right: CommentThread[]) {
  if (left === right) {
    return true;
  }

  if (left.length !== right.length) {
    return false;
  }

  return left.every(
    (thread, index) => serializeComparableThread(thread) === serializeComparableThread(right[index]!),
  );
}

function collectExactQuoteCandidates(thread: CommentThread, containers: CommentTargetContainer[]) {
  const candidates: AnchorRepairCandidate[] = [];
  const quote = thread.quote;

  if (quote.length === 0) {
    return candidates;
  }

  for (const container of containers) {
    let searchIndex = 0;

    while (searchIndex <= container.text.length) {
      const matchIndex = container.text.indexOf(quote, searchIndex);

      if (matchIndex === -1) {
        break;
      }

      candidates.push({
        container,
        endOffset: matchIndex + quote.length,
        score: scoreExactCandidate(thread, container, matchIndex),
        startOffset: matchIndex,
        strategy: "quote-selector",
      });
      searchIndex = matchIndex + Math.max(1, quote.length);
    }
  }

  candidates.sort((left, right) => right.score - left.score);

  return candidates;
}

function collectContextRepairCandidates(
  thread: CommentThread,
  containers: CommentTargetContainer[],
) {
  const candidates: AnchorRepairCandidate[] = [];

  for (const container of containers) {
    candidates.push(...collectContainerContextCandidates(thread, container));
  }

  candidates.sort((left, right) => right.score - left.score);

  return candidates;
}

function collectContainerContextCandidates(
  thread: CommentThread,
  container: CommentTargetContainer,
) {
  const candidates: AnchorRepairCandidate[] = [];
  const originalLength = thread.quote.length;
  const text = container.text;
  const prefix = thread.anchor.prefix ?? "";
  const suffix = thread.anchor.suffix ?? "";

  if (prefix.length > 0 && suffix.length > 0) {
    let prefixSearchIndex = 0;

    while (prefixSearchIndex <= text.length) {
      const prefixIndex = text.indexOf(prefix, prefixSearchIndex);

      if (prefixIndex === -1) {
        break;
      }

      const startOffset = prefixIndex + prefix.length;
      const suffixIndex = text.indexOf(suffix, startOffset);

      if (suffixIndex !== -1 && suffixIndex >= startOffset) {
        candidates.push({
          container,
          endOffset: suffixIndex,
          score: scoreContextCandidate(thread, container, startOffset, suffixIndex, originalLength),
          startOffset,
          strategy: "text-offset",
        });
      }

      prefixSearchIndex = prefixIndex + Math.max(1, prefix.length);
    }

    return candidates;
  }

  if (prefix.length > 0) {
    let prefixSearchIndex = 0;

    while (prefixSearchIndex <= text.length) {
      const prefixIndex = text.indexOf(prefix, prefixSearchIndex);

      if (prefixIndex === -1) {
        break;
      }

      const startOffset = prefixIndex + prefix.length;
      const endOffset = clamp(startOffset + originalLength, startOffset, text.length);

      candidates.push({
        container,
        endOffset,
        score: scoreContextCandidate(thread, container, startOffset, endOffset, originalLength),
        startOffset,
        strategy: "text-offset",
      });
      prefixSearchIndex = prefixIndex + Math.max(1, prefix.length);
    }

    return candidates;
  }

  if (suffix.length > 0) {
    let suffixSearchIndex = 0;

    while (suffixSearchIndex <= text.length) {
      const suffixIndex = text.indexOf(suffix, suffixSearchIndex);

      if (suffixIndex === -1) {
        break;
      }

      const endOffset = suffixIndex;
      const startOffset = clamp(endOffset - originalLength, 0, endOffset);

      candidates.push({
        container,
        endOffset,
        score: scoreContextCandidate(thread, container, startOffset, endOffset, originalLength),
        startOffset,
        strategy: "text-offset",
      });
      suffixSearchIndex = suffixIndex + Math.max(1, suffix.length);
    }
  }

  return candidates;
}

function finalizeRepair(
  thread: CommentThread,
  candidates: AnchorRepairCandidate[],
  options?: {
    diagnostics?: string[];
    forceStatus?: "repaired";
  },
): CommentRepairResult {
  const [first, second] = candidates;

  if (!first) {
    return {
      diagnostics: ["Anchor could not be repaired."],
      match: null,
      repairedThread: null,
      status: "stale",
      strategy: null,
    };
  }

  if (second && first.score === second.score) {
    return {
      diagnostics: ["Anchor matched multiple semantic locations with the same confidence."],
      match: null,
      repairedThread: null,
      status: "ambiguous",
      strategy: null,
    };
  }

  const repairedAnchor = createCommentAnchorFromContainer(
    first.container,
    first.startOffset,
    first.endOffset,
  );
  const repairedQuote = createCommentQuoteFromContainer(
    first.container,
    first.startOffset,
    first.endOffset,
  );
  const status =
    options?.forceStatus ??
    (repairedQuote === thread.quote &&
    (repairedAnchor.prefix ?? "") === (thread.anchor.prefix ?? "") &&
    (repairedAnchor.suffix ?? "") === (thread.anchor.suffix ?? "")
      ? "unchanged"
      : "repaired");

  return {
    repairedThread: {
      quote: repairedQuote,
      anchor: repairedAnchor,
      comments: thread.comments,
      resolvedAt: thread.resolvedAt,
    },
    diagnostics: options?.diagnostics ?? [],
    match: toAnchorMatch(first.container, first.startOffset, first.endOffset),
    status,
    strategy: first.strategy,
  };
}

function toAnchorMatch(
  container: CommentTargetContainer,
  startOffset: number,
  endOffset: number,
): CommentAnchorMatch {
  return {
    containerId: container.id,
    containerKind: container.containerKind,
    containerOrdinal: container.containerOrdinal,
    endOffset,
    startOffset,
  };
}

function scoreExactCandidate(
  thread: CommentThread,
  container: CommentTargetContainer,
  startOffset: number,
) {
  let score = 0;

  if (
    thread.anchor.prefix &&
    container.text.slice(Math.max(0, startOffset - thread.anchor.prefix.length), startOffset) ===
      thread.anchor.prefix
  ) {
    score += 48;
  }

  if (
    thread.anchor.suffix &&
    container.text.slice(
      startOffset + thread.quote.length,
      startOffset + thread.quote.length + thread.anchor.suffix.length,
    ) === thread.anchor.suffix
  ) {
    score += 48;
  }

  return score;
}

function scoreContextCandidate(
  thread: CommentThread,
  container: CommentTargetContainer,
  startOffset: number,
  endOffset: number,
  originalLength: number,
) {
  let score = 0;

  if (
    thread.anchor.prefix &&
    container.text.slice(Math.max(0, startOffset - thread.anchor.prefix.length), startOffset) ===
      thread.anchor.prefix
  ) {
    score += 64;
  }

  if (
    thread.anchor.suffix &&
    container.text.slice(endOffset, endOffset + thread.anchor.suffix.length) === thread.anchor.suffix
  ) {
    score += 64;
  }

  score += Math.max(0, 32 - Math.abs(originalLength - (endOffset - startOffset)));

  if (thread.quote.length > 0) {
    const candidateText = container.text.slice(startOffset, endOffset);

    if (candidateText.length > 0) {
      score += sharedCharacterPrefixLength(thread.quote, candidateText);
      score += sharedCharacterSuffixLength(thread.quote, candidateText);
    }
  }

  return score;
}

function normalizeCommentThread(candidate: unknown): CommentThread | null {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return null;
  }

  const record = candidate as Record<string, unknown>;
  const anchor = normalizeCommentAnchor(record.anchor);
  const quote = typeof record.quote === "string" ? record.quote : null;
  const comments = Array.isArray(record.comments)
    ? record.comments.flatMap((comment) => {
        const normalized = normalizeComment(comment);

        return normalized ? [normalized] : [];
      })
    : [];

  if (!anchor || !quote || comments.length === 0) {
    return null;
  }

  return {
    quote,
    anchor,
    comments,
    resolvedAt: typeof record.resolvedAt === "string" ? record.resolvedAt : undefined,
  };
}

function normalizeCommentAnchor(candidate: unknown): CommentAnchor | null {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return null;
  }

  const record = candidate as Record<string, unknown>;

  if (
    ("kind" in record && record.kind !== "code" && record.kind !== "tableCell") ||
    ("prefix" in record && typeof record.prefix !== "string") ||
    ("suffix" in record && typeof record.suffix !== "string")
  ) {
    return null;
  }

  return {
    kind: record.kind as "code" | "tableCell" | undefined,
    prefix: record.prefix as string | undefined,
    suffix: record.suffix as string | undefined,
  };
}

function normalizeComment(candidate: unknown): Comment | null {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return null;
  }

  const record = candidate as Record<string, unknown>;

  if (
    typeof record.body !== "string" ||
    typeof record.updatedAt !== "string"
  ) {
    return null;
  }

  return {
    body: record.body,
    updatedAt: record.updatedAt,
  };
}

function sharedCharacterPrefixLength(left: string, right: string) {
  let length = 0;

  while (length < left.length && length < right.length && left[length] === right[length]) {
    length += 1;
  }

  return length;
}

function sharedCharacterSuffixLength(left: string, right: string) {
  let length = 0;

  while (
    length < left.length &&
    length < right.length &&
    left[left.length - 1 - length] === right[right.length - 1 - length]
  ) {
    length += 1;
  }

  return length;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function serializeComparableThread(thread: CommentThread) {
  return JSON.stringify(thread);
}

function resolveCommentAnchorKind(anchor: CommentAnchor) {
  return anchor.kind ?? "text";
}

type AnchorRepairCandidate = {
  container: CommentTargetContainer;
  endOffset: number;
  score: number;
  startOffset: number;
  strategy: "quote-selector" | "text-offset";
};
