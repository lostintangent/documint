// Inline container plumbing: types, splicing primitives, and the shared
// machinery that turns a `(container, range, nextChildren)` triple into an
// `InlineContainerReplacement` the reducer can apply.
import {
  createTableCell as createDocumentTableCell,
  createRaw,
  createText,
  defragmentTextInlines,
  rebuildTableBlock,
  rebuildTextBlock,
  type Block,
  type Inline,
} from "@/document";
import {
  editorInlineTextLength,
  inlineNodesWithEditorRanges,
} from "@/editor/text/inline-offsets";
import { target, type RegionPathSelectionTarget } from "../../../selection";
import type { EditorStateAction } from "../../../types";
import type { InlineContainer } from "../../context";

export type { InlineContainer } from "../../context";

export type InlineContainerReplacement = {
  block: Block;
  blockPath: string;
  selection: RegionPathSelectionTarget;
};

// Wraps an inline-container rebuild in the reducer action that commits the
// owning block. Most inline edits want the replacement's own selection; callers
// that intentionally preserve the current selection can build the action
// directly and omit `selection`.
export function createInlineReplacementAction(
  replacement: InlineContainerReplacement,
): EditorStateAction {
  return {
    kind: "replace-block",
    block: replacement.block,
    blockPath: replacement.blockPath,
    selection: replacement.selection,
  };
}

// Splices `inlines` into the container's children over `[startOffset, endOffset]`,
// then rebuilds the owning block (paragraph/heading in place, table cell
// via parent rebuild) and emits an `InlineContainerReplacement` with the
// caret landing at the end of the inserted content.
export function spliceInlineContainer(
  inlineContainer: InlineContainer,
  startOffset: number,
  endOffset: number,
  inlines: Inline[],
): InlineContainerReplacement {
  const nextChildren = spliceInlineNodes(inlineContainer.children, startOffset, endOffset, inlines);
  const insertedLength = inlines.reduce((total, node) => total + editorInlineTextLength(node), 0);
  const caretOffset = startOffset + insertedLength;

  return createInlineContainerReplacement(inlineContainer, nextChildren, caretOffset, caretOffset);
}

export function createInlineContainerReplacement(
  inlineContainer: InlineContainer,
  nextChildren: Inline[],
  startOffset: number,
  endOffset: number,
): InlineContainerReplacement {
  switch (inlineContainer.kind) {
    case "inlineBlock":
      return {
        block: rebuildTextBlock(inlineContainer.block, nextChildren),
        blockPath: inlineContainer.blockPath,
        selection: target.path(inlineContainer.regionPath, startOffset, endOffset),
      };
    case "tableCell": {
      const nextCell = createDocumentTableCell(nextChildren);
      const nextRows = inlineContainer.block.rows.map((row) => ({
        ...row,
        cells: row.cells.map((cell) => (cell === inlineContainer.cell ? nextCell : cell)),
      }));

      return {
        block: rebuildTableBlock(inlineContainer.block, nextRows),
        blockPath: inlineContainer.blockPath,
        selection: target.path(inlineContainer.regionPath, startOffset, endOffset),
      };
    }
  }
}

// This document-inline splice path handles structured `Inline[]` replacement
// for object/link/mark commands. Text editing uses reducer/inlines.ts instead,
// where `IndexedInline[]` has already flattened link wrappers into metadata.
// Splices a sequence of inline nodes into `nodes` over the offset range
// `[startOffset, endOffset]`. The range is dropped from the source, the
// `replacement` nodes are inserted at the start of that range, and the
// surrounding prefix/suffix slices are preserved with their marks/links/
// images intact. An empty `replacement` array is the pure-delete case.
export function spliceInlineNodes(
  nodes: Inline[],
  startOffset: number,
  endOffset: number,
  replacement: Inline[],
): Inline[] {
  const nextNodes: Inline[] = [];
  let inserted = false;

  for (const { node, start, end } of inlineNodesWithEditorRanges(nodes)) {
    if (!inserted && startOffset <= start) {
      nextNodes.push(...replacement);
      inserted = true;
    }

    if (endOffset <= start || startOffset >= end) {
      nextNodes.push(node);
      continue;
    }

    if (!inserted) {
      nextNodes.push(...sliceInlineNode(node, 0, Math.max(0, startOffset - start)));
      nextNodes.push(...replacement);
      inserted = true;
    }

    nextNodes.push(...sliceInlineNode(node, Math.min(end - start, endOffset - start), end - start));
  }

  if (!inserted) {
    nextNodes.push(...replacement);
  }

  return defragmentTextInlines(nextNodes);
}

function sliceInlineNode(node: Inline, startOffset: number, endOffset: number): Inline[] {
  if (startOffset >= endOffset) {
    return [];
  }

  switch (node.type) {
    case "text": {
      const slicedText = node.text.slice(startOffset, endOffset);
      return slicedText.length > 0 ? [createText(slicedText, node.marks)] : [];
    }
    case "link": {
      const children = defragmentTextInlines(
        sliceInlineChildren(node.children, startOffset, endOffset),
      );
      return children.length > 0 ? [{ ...node, children }] : [];
    }
    case "raw": {
      const slicedSource = node.source.slice(startOffset, endOffset);
      return slicedSource.length > 0
        ? [createRaw({ originalType: node.originalType, source: slicedSource })]
        : [];
    }
  }

  return [];
}

export function sliceInlineChildren(nodes: Inline[], startOffset: number, endOffset: number) {
  const sliced: Inline[] = [];

  for (const { node, start, end } of inlineNodesWithEditorRanges(nodes)) {
    if (endOffset <= start || startOffset >= end) {
      continue;
    }

    sliced.push(
      ...sliceInlineNode(
        node,
        Math.max(0, startOffset - start),
        Math.min(end - start, endOffset - start),
      ),
    );
  }

  return sliced;
}
