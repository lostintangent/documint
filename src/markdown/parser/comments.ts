/**
 * Owns markdown-specific extraction of the trailing comment directive,
 * including the JSON array envelope that wraps persisted comment threads.
 */

import {
  parseCommentThread,
  type Block,
  type CommentThread,
  type DirectiveBlock,
} from "@/document";
import { commentDirectiveName } from "../shared";

export function extractCommentDirective(blocks: Block[]) {
  // Only the trailing comment directive is parsed as comments; comment
  // directives anywhere else in the document are silently dropped from output
  // rather than rendered as content. That asymmetry is why we capture-then-
  // filter instead of doing both in one pass.
  const lastBlock = blocks.at(-1);
  const trailingCommentBlock =
    lastBlock && isCommentDirectiveBlock(lastBlock) ? lastBlock : null;
  const contentBlocks = blocks.filter((block) => !isCommentDirectiveBlock(block));

  return {
    blocks: contentBlocks,
    comments: trailingCommentBlock ? parseCommentThreads(trailingCommentBlock.body) : [],
  };
}

// Soft-fails to an empty array on any malformed input — invalid JSON, a
// non-array root, or array entries that don't shape-check as comment threads.
function parseCommentThreads(body: string): CommentThread[] {
  let parsed: unknown;

  try {
    parsed = JSON.parse(body);
  } catch {
    return [];
  }

  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed.flatMap((candidate) => {
    const thread = parseCommentThread(candidate);
    return thread ? [thread] : [];
  });
}

function isCommentDirectiveBlock(block: Block): block is DirectiveBlock {
  return block.type === "directive" && block.name === commentDirectiveName;
}
