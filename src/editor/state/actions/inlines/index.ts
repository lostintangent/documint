// Inline actions barrel + selection-driven orchestration. Resolves which
// block or table cell holds the inline nodes for a given region, and
// hands off to the splice helpers in `shared.ts` to produce a replacement
// the reducer can apply.
//
// More specific inline actions live in sibling modules (marks, code, links)
// and are re-exported from here.

import { findBlockById, type Block, type Inline } from "@/document";
import type { DocumentIndex } from "../../index/types";
import type { EditorStateAction } from "../../types";
import type { EditorSelection } from "../../selection";
import {
  selectedNodePath,
  spliceRegionInlines,
  type InlineRegion,
  type InlineRegionReplacement,
} from "./shared";

export type { InlineRegion, InlineRegionReplacement } from "./shared";

export { toggleInlineMark, resolveInlineMarks } from "./marks";
export { toggleInlineCode } from "./code";
export { removeInlineLink, updateInlineLinkUrl, wrapInlineLink } from "./links";

export function resolveInlineRegion(documentIndex: DocumentIndex, regionId: string) {
  const region = documentIndex.regionIndex.get(regionId);

  if (!region) {
    return null;
  }

  const block = findBlockById(documentIndex.document.blocks, region.blockId);

  if (!block) {
    return null;
  }

  return resolveInlineRegionFromBlock(block, region.path, region.semanticRegionId);
}

export function resolveInlineRegionFromBlock(
  block: Block,
  regionPath: string,
  semanticRegionId: string,
): InlineRegion | null {
  if (block.type === "heading" || block.type === "paragraph") {
    return {
      block,
      children: block.children,
      kind: "inlineBlock",
      path: regionPath.replace(/\.children$/, ""),
    };
  }

  if (block.type !== "table") {
    return null;
  }

  const cellPathMatch = /^(.*\.rows\.\d+\.cells\.\d+)$/.exec(regionPath);

  if (!cellPathMatch) {
    return null;
  }

  for (const row of block.rows) {
    for (const cell of row.cells) {
      if (cell.id === semanticRegionId) {
        return {
          block,
          blockPath: cellPathMatch[1]!.replace(/\.rows\.\d+\.cells\.\d+$/, ""),
          cell,
          children: cell.children,
          kind: "tableCell",
          path: cellPathMatch[1]!,
        };
      }
    }
  }

  return null;
}

// Resolves the region for `regionId`, runs `applyEdit` on it, and wraps
// the resulting replacement (if any) in a `replace-block` action. Used
// by commands that take an explicit `regionId` rather than dispatching
// off the current selection.
export function replaceInlineRange(
  documentIndex: DocumentIndex,
  regionId: string,
  startOffset: number,
  endOffset: number,
  applyEdit: (
    inlineRegion: InlineRegion,
    startOffset: number,
    endOffset: number,
  ) => InlineRegionReplacement | null,
): EditorStateAction | null {
  if (startOffset >= endOffset) {
    return null;
  }

  const inlineRegion = resolveInlineRegion(documentIndex, regionId);

  if (!inlineRegion) {
    return null;
  }

  const replacement = applyEdit(inlineRegion, startOffset, endOffset);

  return replacement
    ? {
        kind: "replace-block",
        block: replacement.block,
        blockId: replacement.blockId,
        selection: replacement.selection,
      }
    : null;
}

// Inserts a single inline node at the selection. The node is built by
// `factory` so the caller can stamp it with a path-aware id. Returns null
// when the selection isn't inside an `InlineRegion` (e.g., a code block,
// whose content is source text rather than inline nodes).
export function insertInlineNode(
  documentIndex: DocumentIndex,
  selection: EditorSelection,
  factory: (path: string) => Inline,
): EditorStateAction | null {
  const range = resolveSelectionInlineRange(documentIndex, selection);

  if (!range) {
    return null;
  }

  const node = factory(selectedNodePath(range.inlineRegion));

  return {
    kind: "replace-block",
    ...spliceRegionInlines(range.inlineRegion, range.startOffset, range.endOffset, [node]),
  };
}

// Splices a sequence of inline nodes into the selection's region at
// `[startOffset, endOffset]`, with caret landing at the end of the
// inserted content. Mirror of `insertInlineNode` for multi-node payloads
// (the inline paste path uses this).
export function insertInlines(
  documentIndex: DocumentIndex,
  selection: EditorSelection,
  inlines: Inline[],
): EditorStateAction | null {
  const range = resolveSelectionInlineRange(documentIndex, selection);

  if (!range) {
    return null;
  }

  return {
    kind: "replace-block",
    ...spliceRegionInlines(range.inlineRegion, range.startOffset, range.endOffset, inlines),
  };
}

// Resolves the focus region's `InlineRegion` plus the canonical
// `[startOffset, endOffset]` range from a selection. Shared by every
// command that splices inline content at the selection point.
function resolveSelectionInlineRange(documentIndex: DocumentIndex, selection: EditorSelection) {
  const inlineRegion = resolveInlineRegion(documentIndex, selection.focus.regionId);

  if (!inlineRegion) {
    return null;
  }

  return {
    inlineRegion,
    startOffset: Math.min(selection.anchor.offset, selection.focus.offset),
    endOffset: Math.max(selection.anchor.offset, selection.focus.offset),
  };
}
