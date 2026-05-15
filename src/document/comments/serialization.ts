/**
 * Defensive normalization of untrusted comment-thread payloads. The envelope
 * (JSON, array shape, storage location) is owned by the persistence layer;
 * this module only validates and shapes one thread at a time.
 */

import { isAnchorKind, normalizeAnchorKind, type TextAnchor } from "../anchors";
import type { Comment, CommentThread } from "./types";

export function parseCommentThread(candidate: unknown): CommentThread | null {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return null;
  }

  const record = candidate as Record<string, unknown>;
  const anchor = parseCommentAnchor(record.anchor);
  const quote = typeof record.quote === "string" ? record.quote : null;
  const comments = Array.isArray(record.comments)
    ? record.comments.flatMap((comment) => {
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
    resolvedAt: typeof record.resolvedAt === "string" ? record.resolvedAt : undefined,
  };
}

function parseComment(candidate: unknown): Comment | null {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return null;
  }

  const record = candidate as Record<string, unknown>;

  if (typeof record.body !== "string" || typeof record.updatedAt !== "string") {
    return null;
  }

  return {
    body: record.body,
    updatedAt: record.updatedAt,
  };
}

function parseCommentAnchor(candidate: unknown): TextAnchor | null {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return null;
  }

  const { kind, prefix, suffix } = candidate as {
    kind?: unknown;
    prefix?: unknown;
    suffix?: unknown;
  };

  if (
    ("kind" in candidate && !isAnchorKind(kind)) ||
    ("prefix" in candidate && typeof prefix !== "string") ||
    ("suffix" in candidate && typeof suffix !== "string")
  ) {
    return null;
  }

  return {
    kind: isAnchorKind(kind) ? normalizeAnchorKind(kind) : undefined,
    prefix: typeof prefix === "string" ? prefix : undefined,
    suffix: typeof suffix === "string" ? suffix : undefined,
  };
}
