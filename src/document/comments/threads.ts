/**
 * Immutable CRUD operations and queries for comment threads.
 */

import {
  FNV_OFFSET_BASIS,
  HASH_SEPARATOR_CHAR_CODE,
  finishHash,
  mixByteIntoHash,
  mixStringIntoHash,
} from "../model/fnv";
import type { TextAnchor } from "../query/anchors/text";
import type { Comment, CommentThread } from "./types";

export function createCommentThread(options: {
  quote: string;
  body: string;
  anchor: TextAnchor;
  createdAt?: string;
}): CommentThread {
  const createdAt = options.createdAt ?? new Date().toISOString();
  const comment = createComment({
    body: options.body,
    updatedAt: createdAt,
  });

  return {
    id: createCommentThreadId(options.anchor, options.quote, options.body, createdAt),
    comments: [comment],
    quote: options.quote,
    anchor: options.anchor,
  };
}

export function replyToCommentThread(
  thread: CommentThread,
  options: {
    body: string;
    updatedAt?: string;
  },
): CommentThread {
  const comment = createComment(options);

  return {
    ...thread,
    comments: [...thread.comments, comment],
  };
}

export function editCommentInThread(
  thread: CommentThread,
  commentIndex: number,
  body: string,
  updatedAt = new Date().toISOString(),
): CommentThread {
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
      updatedAt,
    };
  });

  if (!didChange) {
    return thread;
  }

  return {
    ...thread,
    comments,
  };
}

export function deleteCommentFromThread(
  thread: CommentThread,
  commentIndex: number,
): CommentThread | null {
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
  };
}

export function markCommentThreadAsResolved(
  thread: CommentThread,
  resolved: boolean,
  resolvedAt = new Date().toISOString(),
): CommentThread {
  if (isResolvedCommentThread(thread) === resolved) {
    return thread;
  }

  return {
    ...thread,
    resolvedAt: resolved ? resolvedAt : undefined,
  };
}

export function isResolvedCommentThread(thread: CommentThread): boolean {
  return thread.resolvedAt != null;
}

export function getCommentThreadUpdatedAt(thread: CommentThread): string | null {
  if (thread.comments.length === 0) {
    return null;
  }

  return thread.comments.reduce(
    (latest, comment) => (comment.updatedAt > latest ? comment.updatedAt : latest),
    thread.comments[0]!.updatedAt,
  );
}

export function createCommentThreadId(
  anchor: TextAnchor,
  quote: string,
  body: string,
  updatedAt: string,
): string {
  // Seed recipe lives here so the build/ layer doesn't have to know about
  // comment-domain field shapes. Markdown persistence omits thread IDs, so the
  // generated handle is derived only from persisted comment content.
  const seed = `${anchor.kind ?? ""}:${anchor.prefix ?? ""}:${anchor.suffix ?? ""}:${quote}:${body}:${updatedAt}`;
  return createDeterministicCommentId("commentThread", seed);
}

function createDeterministicCommentId(type: string, semanticSeed: string): string {
  let hash = FNV_OFFSET_BASIS;
  hash = mixStringIntoHash(hash, type);
  hash = mixByteIntoHash(hash, HASH_SEPARATOR_CHAR_CODE);
  hash = mixStringIntoHash(hash, semanticSeed);

  return `${type}-${finishHash(hash).toString(36)}`;
}

function createComment(options: { body: string; updatedAt?: string }): Comment {
  return {
    body: options.body,
    updatedAt: options.updatedAt ?? new Date().toISOString(),
  };
}
