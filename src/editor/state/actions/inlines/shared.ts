// Inline node traversal and slicing primitives shared across inline command modules.
import {
  createCode as createDocumentInlineCodeNode,
  createText as createDocumentTextNode,
  defragmentTextInlines,
  extractPlainTextFromInlineNodes,
  type Code,
  type Inline,
  type Mark,
  type Text,
} from "@/document";
import { INLINE_OBJECT_REPLACEMENT_TEXT } from "../../index/shared";

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

export function collectInlinePrefix(node: Inline, offset: number, path: string): Inline[] {
  if (offset <= 0) {
    return [];
  }

  return sliceInlineNode(node, 0, offset, `${path}.before`);
}

export function collectInlineSuffix(node: Inline, offset: number, path: string): Inline[] {
  const nodeLength = measureInlineNodeText(node);

  if (offset >= nodeLength) {
    return [];
  }

  return sliceInlineNode(node, offset, nodeLength, `${path}.after`);
}

export function sliceInlineNode(
  node: Inline,
  startOffset: number,
  endOffset: number,
  path: string,
): Inline[] {
  if (startOffset >= endOffset) {
    return [];
  }

  switch (node.type) {
    case "text":
      return defragmentTextInlines(
        [createPathTextNode(node.text.slice(startOffset, endOffset), node.marks, path)].filter(
          Boolean,
        ) as Text[],
      );
    case "code":
      return [createPathInlineCodeNode(node.code.slice(startOffset, endOffset), path)];
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

export function createPathTextNode(text: string, marks: Mark[], path: string) {
  if (text.length === 0) {
    return null;
  }

  return createDocumentTextNode({
    marks,
    path,
    text,
  }) satisfies Text;
}

export function createPathInlineCodeNode(code: string, path: string): Code {
  return createDocumentInlineCodeNode({
    code,
    path,
  });
}

function sliceInlineChildren(
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
