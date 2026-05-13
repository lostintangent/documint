// Inline container plumbing: types, splicing primitives, and the shared
// machinery that turns a `(container, range, nextChildren)` triple into an
// `InlineContainerReplacement` the reducer can apply.
import {
  childContainerPath,
  createCode,
  createTableCell as createDocumentTableCell,
  createText,
  defragmentTextInlines,
  extractPlainTextFromInlineNodes,
  rebuildTableBlock,
  rebuildTextBlock,
  type Block,
  type Inline,
} from "@/document";
import type { RegionRangePathSelectionTarget } from "../../selection";
import { INLINE_OBJECT_REPLACEMENT_TEXT } from "../../index/shared";
import type { InlineContainer } from "../../context";

export type { InlineContainer } from "../../context";

export type InlineContainerReplacement = {
  block: Block;
  blockId: string;
  selection: RegionRangePathSelectionTarget;
};

export function measureInlineNodeText(node: Inline) {
  switch (node.type) {
    case "lineBreak":
      return 1;
    case "image":
    case "mention":
      return INLINE_OBJECT_REPLACEMENT_TEXT.length;
    case "code":
      return node.code.length;
    case "link":
      return extractPlainTextFromInlineNodes(node.children).length;
    case "text":
      return node.text.length;
    case "raw":
      return node.source.length;
  }
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
  let cursor = 0;
  let inserted = false;

  for (const node of nodes) {
    const nodeLength = measureInlineNodeText(node);
    const nodeStart = cursor;
    const nodeEnd = nodeStart + nodeLength;
    cursor = nodeEnd;

    if (endOffset <= nodeStart || startOffset >= nodeEnd) {
      nextNodes.push(node);
      continue;
    }

    if (!inserted) {
      nextNodes.push(...collectInlinePrefix(node, Math.max(0, startOffset - nodeStart)));
      nextNodes.push(...replacement);
      inserted = true;
    }

    nextNodes.push(...collectInlineSuffix(node, Math.min(nodeLength, endOffset - nodeStart)));
  }

  if (!inserted) {
    nextNodes.push(...replacement);
  }

  return defragmentTextInlines(nextNodes);
}

function collectInlinePrefix(node: Inline, offset: number): Inline[] {
  if (offset <= 0) {
    return [];
  }

  return sliceInlineNode(node, 0, offset);
}

function collectInlineSuffix(node: Inline, offset: number): Inline[] {
  const nodeLength = measureInlineNodeText(node);

  if (offset >= nodeLength) {
    return [];
  }

  return sliceInlineNode(node, offset, nodeLength);
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
    case "code":
      return [createCode(node.code.slice(startOffset, endOffset))];
    case "link": {
      const children = defragmentTextInlines(
        sliceInlineChildren(node.children, startOffset, endOffset),
      );
      return children.length > 0 ? [{ ...node, children }] : [];
    }
    default:
      return [];
  }
}

export function extractInlineSelectionText(
  nodes: Inline[],
  startOffset: number,
  endOffset: number,
): string {
  let cursor = 0;
  let text = "";

  for (const node of nodes) {
    const nodeLength = measureInlineNodeText(node);
    const nodeStart = cursor;
    const nodeEnd = nodeStart + nodeLength;
    cursor = nodeEnd;

    if (endOffset <= nodeStart || startOffset >= nodeEnd) {
      continue;
    }

    text += extractInlineNodeSlice(
      node,
      Math.max(0, startOffset - nodeStart),
      Math.min(nodeLength, endOffset - nodeStart),
    );
  }

  return text;
}

export function sliceInlineChildren(nodes: Inline[], startOffset: number, endOffset: number) {
  const sliced: Inline[] = [];
  let cursor = 0;

  for (const node of nodes) {
    const nodeLength = measureInlineNodeText(node);
    const nodeStart = cursor;
    const nodeEnd = nodeStart + nodeLength;
    cursor = nodeEnd;

    if (endOffset <= nodeStart || startOffset >= nodeEnd) {
      continue;
    }

    sliced.push(
      ...sliceInlineNode(
        node,
        Math.max(0, startOffset - nodeStart),
        Math.min(nodeLength, endOffset - nodeStart),
      ),
    );
  }

  return sliced;
}

function extractInlineNodeSlice(node: Inline, startOffset: number, endOffset: number): string {
  if (startOffset >= endOffset) {
    return "";
  }

  switch (node.type) {
    case "lineBreak":
      return "\n".slice(startOffset, endOffset);
    case "image":
    case "mention":
      return INLINE_OBJECT_REPLACEMENT_TEXT.slice(startOffset, endOffset);
    case "code":
      return node.code.slice(startOffset, endOffset);
    case "link":
      return extractInlineSelectionText(node.children, startOffset, endOffset);
    case "text":
      return node.text.slice(startOffset, endOffset);
    case "raw":
      return node.source.slice(startOffset, endOffset);
  }
}
