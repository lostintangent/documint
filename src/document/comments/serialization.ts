/**
 * Defensive normalization of untrusted comment-thread payloads. The envelope
 * (JSON, array shape, storage location) is owned by the persistence layer;
 * this module only validates and shapes one thread at a time.
 */

import { isAnchorKind, normalizeAnchorKind } from "../query/anchors/text";
import type { Comment, CommentAnchor, CommentThread } from "./types";

export function parseCommentThread(candidate: unknown): CommentThread | null {
  if (!isRecord(candidate)) {
    return null;
  }

  // Every anchor field is optional, so a missing anchor is an empty one. An
  // empty quote means the commented text was deleted, and the thread still loads.
  const anchor = parseCommentAnchor(candidate.anchor ?? {});
  const quote = typeof candidate.quote === "string" ? candidate.quote : null;
  const comments = Array.isArray(candidate.comments)
    ? candidate.comments.flatMap((comment) => {
        const parsed = parseComment(comment);

        return parsed ? [parsed] : [];
      })
    : [];

  if (!anchor || quote === null || comments.length === 0) {
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
// so `undefined` means the field was absent. A malformed `occurrence` is
// dropped rather than failing the thread, since it's only a tiebreak.
function parseCommentAnchor(candidate: unknown): CommentAnchor | null {
  if (!isRecord(candidate)) {
    return null;
  }

  const { kind, occurrence, prefix, suffix } = candidate;

  if (
    (kind === undefined || isAnchorKind(kind)) &&
    (prefix === undefined || typeof prefix === "string") &&
    (suffix === undefined || typeof suffix === "string")
  ) {
    const anchor = { kind: normalizeAnchorKind(kind), prefix, suffix };

    return typeof occurrence === "number" && Number.isSafeInteger(occurrence) && occurrence > 0
      ? { ...anchor, occurrence }
      : anchor;
  }

  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
