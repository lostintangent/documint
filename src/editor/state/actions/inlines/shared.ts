// Inline region plumbing: types, splicing primitives, and the shared
// machinery that turns a `(region, range, nextChildren)` triple into an
// `InlineRegionReplacement` the reducer can apply.
import {
  createCode,
  createTableCell as createDocumentTableCell,
  createText,
  defragmentTextInlines,
  extractPlainTextFromInlineNodes,
  rebuildTableBlock,
  rebuildTextBlock,
  type Block,
  type HeadingBlock,
  type Inline,
  type ParagraphBlock,
  type TableBlock,
  type TableCell,
} from "@/document";
import type { RegionRangePathSelectionTarget } from "../../selection";
import { INLINE_OBJECT_REPLACEMENT_TEXT } from "../../index/shared";

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

export function measureInlineNodeText(node: Inline) {
  switch (node.type) {
    case "lineBreak":
      return 1;
    case "image":
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

// Path suffix used by inline actions when stamping a node that represents
// the current selection range — feeds `resolveNodeId` so the new node gets
// a deterministic id derived from where it lives.
export function selectedNodePath(inlineRegion: InlineRegion) {
  return `${inlineRegion.path}.children.selected`;
}

// Splices `inlines` into the region's children over `[startOffset, endOffset]`,
// then rebuilds the owning block (paragraph/heading in place, table cell
// via parent rebuild) and emits an `InlineRegionReplacement` with the
// caret landing at the end of the inserted content.
export function spliceRegionInlines(
  inlineRegion: InlineRegion,
  startOffset: number,
  endOffset: number,
  inlines: Inline[],
): InlineRegionReplacement {
  const childrenPath = `${inlineRegion.path}.children`;
  const nextChildren = spliceInlineNodes(
    inlineRegion.children,
    startOffset,
    endOffset,
    childrenPath,
    inlines,
  );
  const insertedLength = inlines.reduce((total, node) => total + measureInlineNodeText(node), 0);
  const caretOffset = startOffset + insertedLength;

  return createInlineRegionReplacement(inlineRegion, nextChildren, caretOffset, caretOffset);
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

// Splices a sequence of inline nodes into `nodes` over the offset range
// `[startOffset, endOffset]`. The range is dropped from the source, the
// `replacement` nodes are inserted at the start of that range, and the
// surrounding prefix/suffix slices are preserved with their marks/links/
// images intact. An empty `replacement` array is the pure-delete case.
export function spliceInlineNodes(
  nodes: Inline[],
  startOffset: number,
  endOffset: number,
  path: string,
  replacement: Inline[],
): Inline[] {
  const nextNodes: Inline[] = [];
  let cursor = 0;
  let inserted = false;

  for (const [index, node] of nodes.entries()) {
    const nodePath = `${path}.${index}`;
    const nodeLength = measureInlineNodeText(node);
    const nodeStart = cursor;
    const nodeEnd = nodeStart + nodeLength;
    cursor = nodeEnd;

    if (endOffset <= nodeStart || startOffset >= nodeEnd) {
      nextNodes.push(node);
      continue;
    }

    if (!inserted) {
      nextNodes.push(...collectInlinePrefix(node, Math.max(0, startOffset - nodeStart), nodePath));
      nextNodes.push(...replacement);
      inserted = true;
    }

    nextNodes.push(
      ...collectInlineSuffix(node, Math.min(nodeLength, endOffset - nodeStart), nodePath),
    );
  }

  if (!inserted) {
    nextNodes.push(...replacement);
  }

  return defragmentTextInlines(nextNodes);
}

function collectInlinePrefix(node: Inline, offset: number, path: string): Inline[] {
  if (offset <= 0) {
    return [];
  }

  return sliceInlineNode(node, 0, offset, `${path}.before`);
}

function collectInlineSuffix(node: Inline, offset: number, path: string): Inline[] {
  const nodeLength = measureInlineNodeText(node);

  if (offset >= nodeLength) {
    return [];
  }

  return sliceInlineNode(node, offset, nodeLength, `${path}.after`);
}

function sliceInlineNode(
  node: Inline,
  startOffset: number,
  endOffset: number,
  path: string,
): Inline[] {
  if (startOffset >= endOffset) {
    return [];
  }

  switch (node.type) {
    case "text": {
      const slicedText = node.text.slice(startOffset, endOffset);
      return slicedText.length > 0
        ? [createText({ text: slicedText, marks: node.marks, path })]
        : [];
    }
    case "code":
      return [createCode({ code: node.code.slice(startOffset, endOffset), path })];
    case "link": {
      const children = defragmentTextInlines(
        sliceInlineChildren(node.children, startOffset, endOffset, `${path}.children`),
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

export function sliceInlineChildren(
  nodes: Inline[],
  startOffset: number,
  endOffset: number,
  path: string,
) {
  const sliced: Inline[] = [];
  let cursor = 0;

  for (const [index, node] of nodes.entries()) {
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
        `${path}.${index}`,
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
