import {
  createParagraphBlock,
  createParagraphTextBlock,
  rootBlockPath,
  type Block,
} from "@/document";
import type { DocumentIndex } from "../../../index/types";
import { resolveBlockTextPathBoundary, resolveRootBlock } from "../../../index/query";
import type { EditorStateAction } from "../../../types";
import { target } from "../../../selection";
import { replaceItemWithRootBlocks } from "../blocks/list";
import { joinAdjacentLists } from "./boundary-collapse";

// The block-demotion override for backward delete.
//
// Backspace at the first in-flow editor path of a root-level wrapper strips
// the wrapping in favor of its content as root blocks:
//
//   - heading       → paragraph with the heading's inline children.
//   - blockquote    → its children spread to root, intact.
//   - list          → its first item's children, ahead of the rest of the
//                     list, as Enter exits an empty first item.
//   - empty code    → empty paragraph.
//
// Block kinds without a meaningful demoted form (paragraph — already
// root text; non-empty code — multiline source can't fit a paragraph;
// table / divider / directive / raw — no clean demote semantic) opt out by
// returning null from `demoteRootBlock`, and the gesture falls through
// to the universal in-flow rule.
//
// The gesture detection — "is the cursor at the first in-flow editor path
// of its root block?" — is one universal check across kinds, which is
// why this is a single function rather than per-kind override
// functions. It's also what naturally limits demotion to root-level
// wrappers: a non-first list item, a non-first blockquote child, or a
// list nested inside another container are all "not at first-in-flow
// of their root," so they fall through to the in-flow rule and get
// the standard backspace-merge behavior.

export function resolveBlockDemotion(
  documentIndex: DocumentIndex,
  path: string,
  rootIndex: number,
): EditorStateAction | null {
  if (resolveBlockTextPathBoundary(documentIndex, rootBlockPath(rootIndex), "start") !== path) {
    return null;
  }

  const rootBlock = resolveRootBlock(documentIndex, rootIndex);
  const blocks = rootBlock ? demoteRootBlock(rootBlock) : null;
  if (!blocks?.[0]) {
    return null;
  }

  return {
    kind: "splice-blocks",
    rootIndex,
    count: 1,
    blocks,
    selection: target.block(blocks[0]),
  };
}

// Returns the root-level demoted form of a block, or null when the
// block kind has no demote semantic. The choice of demoted form is
// structure-preserving where possible — heading carries its inline
// children into the new paragraph (marks/links survive), and blockquote
// and first list item children pass through intact.
function demoteRootBlock(block: Block): Block[] | null {
  switch (block.type) {
    case "heading":
      return [createParagraphBlock(block.children)];
    case "blockquote":
      return [...block.children];
    case "list":
      return joinAdjacentLists(replaceItemWithRootBlocks(block, 0, block.items[0]!.children));
    case "code":
      return block.source.length === 0 ? [createParagraphTextBlock("")] : null;
    default:
      return null;
  }
}
