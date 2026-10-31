/**
 * Defensive normalization of untrusted comment-thread payloads. The envelope
 * (JSON, array shape, storage location) is owned by the persistence layer;
 * this module only validates and shapes one thread at a time.
 */

import { isAnchorKind, normalizeAnchorKind, type TextAnchor } from "../query/anchors/text";
import type { Comment, CommentThread } from "./types";

export function parseCommentThread(candidate: unknown): CommentThread | null {
  if (!isRecord(candidate)) {
    return null;
  }

  const anchor = parseCommentAnchor(candidate.anchor);
  const quote = typeof candidate.quote === "string" ? candidate.quote : null;
  const comments = Array.isArray(candidate.comments)
    ? candidate.comments.flatMap((comment) => {
        const parsed = parseComment(comment);

        return parsed ? [parsed] : [];
      })
    : [];

  if (!anchor || !quote || comments.length === 0) {
    return null;
  }

  return {
    id: "",
    quote,
    anchor,
    comments,
    resolvedAt: typeof candidate.resolvedAt === "string" ? candidate.resolvedAt : undefined,
  };
}

function parseComment(candidate: unknown): Comment | null {
  if (
    !isRecord(candidate) ||
    typeof candidate.body !== "string" ||
    typeof candidate.updatedAt !== "string"
  ) {
    return null;
  }

  return {
    body: candidate.body,
    updatedAt: candidate.updatedAt,
  };
}

// Payloads come from `JSON.parse`, which never produces an `undefined` field,
// so `undefined` means the field was absent.
function parseCommentAnchor(candidate: unknown): TextAnchor | null {
  if (!isRecord(candidate)) {
    return null;
  }

  const { kind, prefix, suffix } = candidate;

  if (
    (kind === undefined || isAnchorKind(kind)) &&
    (prefix === undefined || typeof prefix === "string") &&
    (suffix === undefined || typeof suffix === "string")
  ) {
    return { kind: normalizeAnchorKind(kind), prefix, suffix };
  }

  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
