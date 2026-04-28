// Inline command target resolution: resolves which block/cell contains the
// inline nodes for a given region, and creates replacement results.
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

export type InlineCommandTarget =
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

export type InlineCommandReplacement = {
  block: Block;
  blockId: string;
  selection: RegionRangePathSelectionTarget;
};

export function resolveInlineRegionTarget(documentIndex: DocumentIndex, regionId: string) {
  const region = documentIndex.regionIndex.get(regionId);

  if (!region) {
    return null;
  }

  const block = findBlockById(documentIndex.document.blocks, region.blockId);

  if (!block) {
    return null;
  }

  return resolveInlineCommandTarget(block, region.path, region.semanticRegionId);
}

export function resolveInlineRangeReplacement(
  documentIndex: DocumentIndex,
  regionId: string,
  startOffset: number,
  endOffset: number,
  applyTargetEdit: (
    target: InlineCommandTarget,
    startOffset: number,
    endOffset: number,
  ) => InlineCommandReplacement | null,
) {
  if (startOffset >= endOffset) {
    return null;
  }

  const target = resolveInlineRegionTarget(documentIndex, regionId);

  return target ? applyTargetEdit(target, startOffset, endOffset) : null;
}

export function replaceInlineRange(
  documentIndex: DocumentIndex,
  regionId: string,
  startOffset: number,
  endOffset: number,
  applyTargetEdit: (
    target: InlineCommandTarget,
    startOffset: number,
    endOffset: number,
  ) => InlineCommandReplacement | null,
): EditorStateAction | null {
  const replacement = resolveInlineRangeReplacement(
    documentIndex,
    regionId,
    startOffset,
    endOffset,
    applyTargetEdit,
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

export function resolveInlineCommandTarget(
  block: Block,
  containerPath: string,
  semanticRegionId: string,
): InlineCommandTarget | null {
  if (block.type === "heading" || block.type === "paragraph") {
    return {
      block,
      children: block.children,
      kind: "inlineBlock",
      path: containerPath.replace(/\.children$/, ""),
    };
  }

  if (block.type !== "table") {
    return null;
  }

  const cellPathMatch = /^(.*\.rows\.\d+\.cells\.\d+)$/.exec(containerPath);

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
  const target = resolveInlineRegionTarget(documentIndex, selection.focus.regionId);

  if (!target) {
    return null;
  }

  const startOffset = Math.min(selection.anchor.offset, selection.focus.offset);
  const endOffset = Math.max(selection.anchor.offset, selection.focus.offset);

  return {
    kind: "replace-block",
    ...insertInlineNodeIntoTarget(target, startOffset, endOffset, factory),
  };
}

export function insertInlineNodeIntoTarget(
  target: InlineCommandTarget,
  startOffset: number,
  endOffset: number,
  factory: (path: string) => Inline,
): InlineCommandReplacement {
  const childrenPath = `${target.path}.children`;
  const node = factory(`${childrenPath}.selected`);
  const nextChildren = spliceInlineNodes(
    target.children,
    startOffset,
    endOffset,
    childrenPath,
    node,
  );

  return createInlineCommandReplacement(target, nextChildren, startOffset + 1, startOffset + 1);
}

export function createInlineCommandReplacement(
  target: InlineCommandTarget,
  nextChildren: Inline[],
  startOffset: number,
  endOffset: number,
): InlineCommandReplacement {
  switch (target.kind) {
    case "inlineBlock":
      return {
        block: rebuildTextBlock(target.block, nextChildren),
        blockId: target.block.id,
        selection: createRangeSelectionTarget(`${target.path}.children`, startOffset, endOffset),
      };
    case "tableCell": {
      const nextCell = createDocumentTableCell({
        children: nextChildren,
        path: target.path,
      });
      const nextRows = target.block.rows.map((row) => ({
        ...row,
        cells: row.cells.map((cell) => (cell.id === target.cell.id ? nextCell : cell)),
      }));

      return {
        block: rebuildTableBlock(target.block, nextRows),
        blockId: target.block.id,
        selection: createRangeSelectionTarget(target.path, startOffset, endOffset),
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
