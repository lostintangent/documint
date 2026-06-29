// Canonical document construction and incremental edits. Builders own semantic
// node canonicalization (`plainText`, mark order, and default values), so this
// layer preserves block object identity and only seals comment-thread IDs.
// The public surface is intentionally tiny: three operations cover every
// document-altering edit the editor, markdown layer, and host can express.

import type { CommentThread } from "../comments";
import { createCommentThreadId } from "../comments/threads";
import type { Block, Document } from "../model/types";

export function createDocument(
  blocks: Block[],
  comments: CommentThread[] = [],
  frontMatter?: string,
): Document {
  return {
    blocks: [...blocks],
    comments: sealCommentThreadIds(comments),
    frontMatter,
  };
}

// Replace `count` root-level blocks at `rootIndex` with `replacements`,
// returning a new document. Roots outside the replacement range keep their
// object identity (`===`) even when their structural path shifts; paths are
// index-time runtime addresses, not fields stamped onto semantic nodes.
export function spliceDocument(
  document: Document,
  rootIndex: number,
  count: number,
  replacements: Block[],
): Document {
  return {
    blocks: [
      ...document.blocks.slice(0, rootIndex),
      ...replacements,
      ...document.blocks.slice(rootIndex + count),
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
  const comments = [
    ...document.comments.slice(0, index),
    ...threads,
    ...document.comments.slice(index + count),
  ];

  return {
    blocks: document.blocks,
    comments: sealCommentThreadIds(comments),
    frontMatter: document.frontMatter,
  };
}

// Comment threads arriving without an `id` (the markdown layer parsed them, or
// a host constructed one ad-hoc) get sealed with the same comment-owned recipe
// `createCommentThread` uses for in-process construction. If persisted content
// contains identical ID-less threads, there is no durable identity signal left;
// duplicates are made unique deterministically by list order within the snapshot.
function sealCommentThreadIds(threads: CommentThread[]): CommentThread[] {
  const seenIds = new Set<string>();
  const collisionCounts = new Map<string, number>();

  return threads.map((thread) => {
    const firstComment = thread.comments[0];
    const baseId =
      thread.id ||
      createCommentThreadId(
        thread.anchor,
        thread.quote,
        firstComment?.body ?? "",
        firstComment?.updatedAt ?? "",
      );
    const id = nextUniqueCommentThreadId(baseId, seenIds, collisionCounts);

    return id === thread.id ? thread : { ...thread, id };
  });
}

function nextUniqueCommentThreadId(
  baseId: string,
  seenIds: Set<string>,
  collisionCounts: Map<string, number>,
) {
  if (!seenIds.has(baseId)) {
    seenIds.add(baseId);
    return baseId;
  }

  let collisionCount = collisionCounts.get(baseId) ?? 1;
  let id = `${baseId}.${collisionCount}`;

  while (seenIds.has(id)) {
    collisionCount += 1;
    id = `${baseId}.${collisionCount}`;
  }

  collisionCounts.set(baseId, collisionCount + 1);
  seenIds.add(id);
  return id;
}
