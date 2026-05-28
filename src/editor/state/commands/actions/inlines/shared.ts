// Inline container plumbing: types, splicing primitives, and the shared
// machinery that turns a `(container, range, nextChildren)` triple into an
// `InlineContainerReplacement` the reducer can apply.
import {
  childContainerPath,
  createTableCell as createDocumentTableCell,
  createText,
  defragmentTextInlines,
  isReferenceInlineNode,
  iterateInlineNodeRanges,
  measureInlineNodeText,
  rebuildTableBlock,
  rebuildTextBlock,
  type Block,
  type Inline,
} from "@/document";
import type { RegionRangePathSelectionTarget } from "../../../selection";
import { INLINE_OBJECT_REPLACEMENT_TEXT } from "../../../index/inlines";
import { type InlineContainer } from "../../inlines";

export type { InlineContainer } from "../../inlines";

export type InlineContainerReplacement = {
  block: Block;
  blockId: string;
  selection: RegionRangePathSelectionTarget;
};

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
  const insertedLength = inlines.reduce((total, node) => total + measureInlineNodeText(node), 0);
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
        blockId: inlineContainer.block.id,
        selection: createRangeSelectionTarget(
          childContainerPath(inlineContainer.path),
          startOffset,
          endOffset,
        ),
      };
    case "tableCell": {
      const nextCell = createDocumentTableCell(nextChildren);
      const nextRows = inlineContainer.block.rows.map((row) => ({
        ...row,
        cells: row.cells.map((cell) => (cell.id === inlineContainer.cell.id ? nextCell : cell)),
      }));

      return {
        block: rebuildTableBlock(inlineContainer.block, nextRows),
        blockId: inlineContainer.block.id,
        selection: createRangeSelectionTarget(inlineContainer.path, startOffset, endOffset),
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

  for (const { node, start, end } of iterateInlineNodeRanges(nodes)) {
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
  }

  return [];
}

export function extractInlineSelectionText(
  nodes: Inline[],
  startOffset: number,
  endOffset: number,
): string {
  let text = "";

  for (const { node, start, end } of iterateInlineNodeRanges(nodes)) {
    if (endOffset <= start || startOffset >= end) {
      continue;
    }

    text += extractInlineNodeSlice(
      node,
      Math.max(0, startOffset - start),
      Math.min(end - start, endOffset - start),
    );
  }

  return text;
}

export function sliceInlineChildren(nodes: Inline[], startOffset: number, endOffset: number) {
  const sliced: Inline[] = [];

  for (const { node, start, end } of iterateInlineNodeRanges(nodes)) {
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

function extractInlineNodeSlice(node: Inline, startOffset: number, endOffset: number): string {
  if (startOffset >= endOffset) {
    return "";
  }

  if (isReferenceInlineNode(node)) {
    return INLINE_OBJECT_REPLACEMENT_TEXT.slice(startOffset, endOffset);
  }

  switch (node.type) {
    case "lineBreak":
      return "\n".slice(startOffset, endOffset);
    case "link":
      return extractInlineSelectionText(node.children, startOffset, endOffset);
    case "text":
      return node.text.slice(startOffset, endOffset);
    case "raw":
      return node.source.slice(startOffset, endOffset);
  }
}
