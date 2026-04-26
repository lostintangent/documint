/**
 * Immutable CRUD operations and queries for comment threads.
 */

import type { Anchor } from "../anchors";
import type { Comment, CommentThread } from "./types";

export function createCommentThread(options: {
  quote: string;
  body: string;
  anchor: Anchor;
  createdAt?: string;
}): CommentThread {
  const createdAt = options.createdAt ?? new Date().toISOString();
  const comment = createComment({
    body: options.body,
    updatedAt: createdAt,
  });

  return {
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

export function isResolvedCommentThread(thread: CommentThread) {
  return thread.resolvedAt != null;
}

export function countResolvedCommentThreads(threads: CommentThread[]) {
  return threads.filter((thread) => isResolvedCommentThread(thread)).length;
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

function createComment(options: { body: string; updatedAt?: string }): Comment {
  const updatedAt = options.updatedAt ?? new Date().toISOString();
  return {
    body: options.body,
    updatedAt,
  };
}
