import {
  createParagraphBlock,
  createParagraphTextBlock,
  rootBlockPath,
  type Block,
  type ListItemBlock,
} from "@/document";
import type { DocumentIndex } from "../../../index/types";
import { resolveBlockTextPathBoundary, resolveRootBlock } from "../../../index/query";
import type { EditorStateAction } from "../../../types";
import { target } from "../../../selection";

// The block-demotion override for backward delete.
//
// Backspace at the first in-flow editor path of a root-level wrapper strips
// the wrapping in favor of its content as root blocks:
//
//   - heading       → paragraph with the heading's inline children.
//   - blockquote    → its children spread to root, intact.
//   - list          → its items flattened to paragraphs (recursively
//                     through nested lists; see note in
//                     `demoteRootBlock` if/when we want to preserve
//                     nested structure at root).
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
  if (!isFirstInFlowRootPath(documentIndex, path, rootIndex)) {
    return null;
  }

  const rootBlock = resolveRootBlock(documentIndex, rootIndex);
  if (!rootBlock) {
    return null;
  }

  const blocks = demoteRootBlock(rootBlock);
  const focusBlock = blocks?.[0];
  if (!blocks || !focusBlock) {
    return null;
  }

  return {
    kind: "splice-blocks",
    rootIndex,
    count: 1,
    blocks,
    selection: target.block(focusBlock),
  };
}

function isFirstInFlowRootPath(
  documentIndex: DocumentIndex,
  path: string,
  rootIndex: number,
): boolean {
  const firstInFlow = resolveBlockTextPathBoundary(
    documentIndex,
    rootBlockPath(rootIndex),
    "start",
  );

  return firstInFlow === path;
}

// Returns the root-level demoted form of a block, or null when the
// block kind has no demote semantic. The choice of demoted form is
// structure-preserving where possible — heading carries its inline
// children into the new paragraph (marks/links survive), blockquote's
// children pass through intact. List demote currently flattens nested
// lists too; a structure-preserving variant (let nested lists survive
// at root) is a one-line change in the `case "list"` branch if you
// want that behavior.
function demoteRootBlock(block: Block): Block[] | null {
  switch (block.type) {
    case "heading":
      return [createParagraphBlock(block.children)];
    case "blockquote":
      return [...block.children];
    case "list":
      return flattenListItemsToParagraphs(block.items);
    case "code":
      return block.source.length === 0 ? [createParagraphTextBlock("")] : null;
    default:
      return null;
  }
}

function flattenListItemsToParagraphs(items: ListItemBlock[]): Block[] {
  return items.flatMap((item) => {
    const blocks: Block[] = [leadingItemAsParagraph(item)];
    for (const child of item.children) {
      if (child.type === "list") {
        blocks.push(...flattenListItemsToParagraphs(child.items));
      }
    }
    return blocks;
  });
}

function leadingItemAsParagraph(item: ListItemBlock): Block {
  const leading = item.children[0];
  if (leading && (leading.type === "paragraph" || leading.type === "heading")) {
    return createParagraphBlock(leading.children);
  }
  return createParagraphTextBlock("");
}
