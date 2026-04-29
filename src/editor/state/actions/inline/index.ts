// Inline actions: the lowest layer of inline editing. Resolves which block
// or table cell holds the inline nodes for a given region, and produces
// replacement results that the reducer can apply.
//
// More specific inline actions live in sibling modules (marks, code, links)
// and are re-exported from here.

import {
  createTableCell as createDocumentTableCell,
  findBlockById,
  rebuildTableBlock,
  rebuildTextBlock,
  type Block,
  type HeadingBlock,
  type Inline,
  type ParagraphBlock,
  type TableBlock,
  type TableCell,
} from "@/document";
import type { DocumentIndex } from "../../index/types";
import type { EditorStateAction } from "../../types";
import type { EditorSelection, RegionRangePathSelectionTarget } from "../../selection";
import { spliceInlineNodes } from "./shared";

export { toggleInlineMark, resolveInlineMarks } from "./marks";
export { toggleInlineCode } from "./code";
export { replaceExactInlineLinkRange, replaceExactInlineLink } from "./links";

// An InlineRegion is the subset of editable regions whose backing data is
// `Inline[]` rather than raw text. Structurally that's Heading, Paragraph,
// and TableCell — ListItem and Blockquote hold `Block[]` (they need
// nesting), and Code regions hold `source: string`.
//
// This isn't the raw block union because each variant carries runtime
// context the block itself doesn't know:
//   - `path`: where this region lives in the document tree
//   - `blockPath` (table cell only): path to the parent TableBlock, needed
//     because replacing a cell rebuilds the whole table
//   - `kind`: discriminates the rebuild strategy — `inlineBlock` rebuilds
//     in place via `rebuildTextBlock`, `tableCell` rebuilds the parent
//     table via `rebuildTableBlock`
export type InlineRegion =
  | {
      block: HeadingBlock | ParagraphBlock;
      children: Inline[];
      kind: "inlineBlock";
      path: string;
    }
  | {
      block: TableBlock;
      blockPath: string;
      cell: TableCell;
      children: Inline[];
      kind: "tableCell";
      path: string;
    };

export type InlineRegionReplacement = {
  block: Block;
  blockId: string;
  selection: RegionRangePathSelectionTarget;
};

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

export function resolveInlineRegionEdit(
  documentIndex: DocumentIndex,
  regionId: string,
  startOffset: number,
  endOffset: number,
  applyEdit: (
    inlineRegion: InlineRegion,
    startOffset: number,
    endOffset: number,
  ) => InlineRegionReplacement | null,
) {
  if (startOffset >= endOffset) {
    return null;
  }

  const inlineRegion = resolveInlineRegion(documentIndex, regionId);

  return inlineRegion ? applyEdit(inlineRegion, startOffset, endOffset) : null;
}

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
  const replacement = resolveInlineRegionEdit(
    documentIndex,
    regionId,
    startOffset,
    endOffset,
    applyEdit,
  );

  return replacement
    ? {
        kind: "replace-block",
        block: replacement.block,
        blockId: replacement.blockId,
        selection: replacement.selection,
      }
    : null;
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

export function insertInlineNode(
  documentIndex: DocumentIndex,
  selection: EditorSelection,
  factory: (path: string) => Inline,
): EditorStateAction | null {
  const inlineRegion = resolveInlineRegion(documentIndex, selection.focus.regionId);

  if (!inlineRegion) {
    return null;
  }

  const startOffset = Math.min(selection.anchor.offset, selection.focus.offset);
  const endOffset = Math.max(selection.anchor.offset, selection.focus.offset);

  return {
    kind: "replace-block",
    ...insertInlineIntoRegion(inlineRegion, startOffset, endOffset, factory),
  };
}

export function insertInlineIntoRegion(
  inlineRegion: InlineRegion,
  startOffset: number,
  endOffset: number,
  factory: (path: string) => Inline,
): InlineRegionReplacement {
  const childrenPath = `${inlineRegion.path}.children`;
  const node = factory(`${childrenPath}.selected`);
  const nextChildren = spliceInlineNodes(
    inlineRegion.children,
    startOffset,
    endOffset,
    childrenPath,
    node,
  );

  return createInlineRegionReplacement(
    inlineRegion,
    nextChildren,
    startOffset + 1,
    startOffset + 1,
  );
}

export function createInlineRegionReplacement(
  inlineRegion: InlineRegion,
  nextChildren: Inline[],
  startOffset: number,
  endOffset: number,
): InlineRegionReplacement {
  switch (inlineRegion.kind) {
    case "inlineBlock":
      return {
        block: rebuildTextBlock(inlineRegion.block, nextChildren),
        blockId: inlineRegion.block.id,
        selection: createRangeSelectionTarget(
          `${inlineRegion.path}.children`,
          startOffset,
          endOffset,
        ),
      };
    case "tableCell": {
      const nextCell = createDocumentTableCell({
        children: nextChildren,
        path: inlineRegion.path,
      });
      const nextRows = inlineRegion.block.rows.map((row) => ({
        ...row,
        cells: row.cells.map((cell) => (cell.id === inlineRegion.cell.id ? nextCell : cell)),
      }));

      return {
        block: rebuildTableBlock(inlineRegion.block, nextRows),
        blockId: inlineRegion.block.id,
        selection: createRangeSelectionTarget(inlineRegion.path, startOffset, endOffset),
      };
    }
  }
}

function createRangeSelectionTarget(
  path: string,
  startOffset: number,
  endOffset: number,
): RegionRangePathSelectionTarget {
  return {
    endOffset,
    kind: "region-range-path",
    path,
    startOffset,
  };
}
