// Canonical document construction and incremental edits. Everything in this
// file produces a fully-normalized `Document`: each block and inline node
// carries a deterministic `id` and a fresh `plainText` projection, both
// derived from the node's path and semantic content by `./normalize`. The
// public surface is intentionally tiny — three operations covers every
// document-altering edit the editor, markdown layer, and host can express.

import type { CommentThread } from "../comments";
import { createCommentThreadId } from "../comments/threads";
import type { Block, Document } from "../model/types";
import { normalizeRootBlock } from "./normalize";

export function createDocument(
  blocks: Block[],
  comments: CommentThread[] = [],
  frontMatter?: string,
): Document {
  return {
    blocks: blocks.map((block, index) => normalizeRootBlock(block, index)),
    comments: normalizeCommentThreads(comments),
    frontMatter,
  };
}

// Replace `count` root-level blocks at `rootIndex` with `replacements`,
// returning a new document. Roots before the splice point keep their
// identity (`===`); roots after it are re-normalized only when their index
// shifts, which is the layout-cache contract the parent AGENTS.md describes.
export function spliceDocument(
  document: Document,
  rootIndex: number,
  count: number,
  replacements: Block[],
): Document {
  const normalizedReplacements = replacements.map((block, index) =>
    normalizeRootBlock(block, rootIndex + index),
  );
  const suffix = document.blocks.slice(rootIndex + count);
  const normalizedSuffix =
    replacements.length === count
      ? suffix
      : suffix.map((block, index) =>
          normalizeRootBlock(block, rootIndex + normalizedReplacements.length + index),
        );

  return {
    blocks: [
      ...document.blocks.slice(0, rootIndex),
      ...normalizedReplacements,
      ...normalizedSuffix,
    ],
    comments: document.comments,
    frontMatter: document.frontMatter,
  };
}

export function spliceCommentThreads(
  document: Document,
  index: number,
  count: number,
  threads: CommentThread[],
): Document {
  return {
    blocks: document.blocks,
    comments: [
      ...document.comments.slice(0, index),
      ...normalizeCommentThreads(threads, index),
      ...document.comments.slice(index + count),
    ],
    frontMatter: document.frontMatter,
  };
}

// Comment threads arriving without an `id` (the persistence layer parsed
// them, or a host constructed one ad-hoc) get sealed with the same identity
// recipe `createCommentThread` uses for in-process construction. Routing
// both call paths through `createCommentThreadId` is what keeps a thread's
// id stable across save → reload — without it, the parsed-then-normalized
// path would assign a different id than the freshly-constructed path.
function normalizeCommentThreads(threads: CommentThread[], startIndex = 0): CommentThread[] {
  return threads.map((thread, index) => {
    if (thread.id) {
      return thread;
    }

    const firstComment = thread.comments[0];

    return {
      ...thread,
      id: createCommentThreadId(
        thread.anchor,
        thread.quote,
        firstComment?.body ?? "",
        firstComment?.updatedAt ?? "",
        `comments.${startIndex + index}`,
      ),
    };
  });
}
