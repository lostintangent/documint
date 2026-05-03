import {
  createParagraphBlock,
  createParagraphTextBlock,
  type Block,
  type ListItemBlock,
} from "@/document";
import type { DocumentIndex, EditorRegion } from "../../index/types";
import type { EditorStateAction } from "../../types";
import { createRootPrimaryRegionTarget, firstInFlowRegionOfRoot } from "../../selection";

// The block-demotion override for backward delete.
//
// Backspace at the first-in-flow region of a root-level wrapper strips
// the wrapping in favor of its content as root blocks:
//
//   - heading       → paragraph with the heading's inline children.
//   - blockquote    → its children spread to root, intact.
//   - list          → its items flattened to paragraphs (recursively
//                     through nested lists; see note in
//                     `demoteRootBlock` if/when we want to preserve
//                     nested structure at root).
//
// Block kinds without a meaningful demoted form (paragraph — already
// root text; code — multiline source can't fit a paragraph; table /
// divider / directive / raw — no clean demote semantic) opt out by
// returning null from `demoteRootBlock`, and the gesture falls through
// to the universal in-flow rule.
//
// The gesture detection — "is the cursor at the first-in-flow region
// of its root block?" — is one universal check across kinds, which is
// why this is a single function rather than per-kind override
// functions. It's also what naturally limits demotion to root-level
// wrappers: a non-first list item, a non-first blockquote child, or a
// list nested inside another container are all "not at first-in-flow
// of their root," so they fall through to the in-flow rule and get
// the standard backspace-merge behavior.

export function resolveBlockDemotion(
  documentIndex: DocumentIndex,
  region: EditorRegion,
): EditorStateAction | null {
  const firstInFlow = firstInFlowRegionOfRoot(documentIndex, region.rootIndex);
  if (!firstInFlow || firstInFlow.id !== region.id) {
    return null;
  }

  const rootBlock = documentIndex.document.blocks[region.rootIndex];
  if (!rootBlock) {
    return null;
  }

  const demoted = demoteRootBlock(rootBlock);
  if (!demoted) {
    return null;
  }

  return {
    kind: "splice-blocks",
    rootIndex: region.rootIndex,
    count: 1,
    blocks: demoted,
    selection: createRootPrimaryRegionTarget(region.rootIndex),
  };
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
      return [createParagraphBlock({ children: block.children })];
    case "blockquote":
      return [...block.children];
    case "list":
      return flattenListItemsToParagraphs(block.items);
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
    return createParagraphBlock({ children: leading.children });
  }
  return createParagraphTextBlock({ text: "" });
}
