// Mark toggling: bold, italic, strikethrough, underline.
import { type Inline, type Mark, type Text } from "@/document";
import { compactInlineNodes } from "../../index/shared";
import type { InlineCommandReplacement, InlineCommandTarget } from "./target";
import { createInlineCommandReplacement } from "./target";
import { measureInlineNodeText, createPathTextNode } from "./shared";

export function toggleInlineMarkTarget(
  target: InlineCommandTarget,
  startOffset: number,
  endOffset: number,
  mark: Extract<Mark, "italic" | "bold" | "strikethrough" | "underline">,
): InlineCommandReplacement | null {
  const removeMark = shouldRemoveInlineMark(target.children, startOffset, endOffset, mark);

  if (removeMark === null) {
    return null;
  }

  const nextChildren = compactInlineNodes(
    toggleInlineNodesMark(
      target.children,
      startOffset,
      endOffset,
      mark,
      removeMark,
      `${target.path}.children`,
    ),
  );

  return nextChildren.length > 0
    ? createInlineCommandReplacement(target, nextChildren, startOffset, endOffset)
    : null;
}

export function resolveInlineCommandMarks(
  target: InlineCommandTarget,
  startOffset: number,
  endOffset: number,
): Mark[] {
  let cursor = 0;
  let commonMarks: Set<Mark> | null = null;

  const visit = (candidates: Inline[]) => {
    for (const node of candidates) {
      const nodeLength = measureInlineNodeText(node);
      const nodeStart = cursor;
      const nodeEnd = nodeStart + nodeLength;
      cursor = nodeEnd;

      if (endOffset <= nodeStart || startOffset >= nodeEnd) {
        continue;
      }

      if (node.type === "text") {
        const overlapStart = Math.max(startOffset, nodeStart);
        const overlapEnd = Math.min(endOffset, nodeEnd);

        if (overlapEnd > overlapStart) {
          commonMarks =
            commonMarks === null
              ? new Set(node.marks)
              : new Set(node.marks.filter((mark) => commonMarks?.has(mark)));
        }

        continue;
      }

      if (node.type === "link") {
        const previousCursor = cursor;
        cursor = nodeStart;
        visit(node.children);
        cursor = previousCursor;
      }
    }
  };

  visit(target.children);

  return commonMarks ? [...commonMarks] : [];
}

function shouldRemoveInlineMark(
  nodes: Inline[],
  startOffset: number,
  endOffset: number,
  mark: Mark,
) {
  let cursor = 0;
  let hasText = false;
  let allMarked = true;

  const visit = (candidates: Inline[]) => {
    for (const node of candidates) {
      const nodeLength = measureInlineNodeText(node);
      const nodeStart = cursor;
      const nodeEnd = nodeStart + nodeLength;
      cursor = nodeEnd;

      if (endOffset <= nodeStart || startOffset >= nodeEnd) {
        continue;
      }

      if (node.type === "text") {
        const overlapStart = Math.max(startOffset, nodeStart);
        const overlapEnd = Math.min(endOffset, nodeEnd);

        if (overlapEnd > overlapStart) {
          hasText = true;
          allMarked &&= node.marks.includes(mark);
        }
        continue;
      }

      if (node.type === "link") {
        const previousCursor = cursor;
        cursor = nodeStart;
        visit(node.children);
        cursor = previousCursor;
      }
    }
  };

  visit(nodes);

  return hasText ? allMarked : null;
}

function toggleInlineNodesMark(
  nodes: Inline[],
  startOffset: number,
  endOffset: number,
  mark: Mark,
  shouldRemove: boolean,
  path: string,
): Inline[] {
  const nextNodes: Inline[] = [];
  let cursor = 0;

  for (const [index, node] of nodes.entries()) {
    const nodeStart = cursor;
    const nodeLength = measureInlineNodeText(node);
    const nodeEnd = nodeStart + nodeLength;
    const nodePath = `${path}.${index}`;

    cursor = nodeEnd;

    if (endOffset <= nodeStart || startOffset >= nodeEnd) {
      nextNodes.push(node);
      continue;
    }

    if (node.type === "text") {
      nextNodes.push(
        ...toggleTextNodeMark(
          node,
          Math.max(0, startOffset - nodeStart),
          Math.min(nodeLength, endOffset - nodeStart),
          mark,
          shouldRemove,
          nodePath,
        ),
      );
      continue;
    }

    if (node.type === "link") {
      const children = compactInlineNodes(
        toggleInlineNodesMark(
          node.children,
          Math.max(0, startOffset - nodeStart),
          Math.min(nodeLength, endOffset - nodeStart),
          mark,
          shouldRemove,
          `${nodePath}.children`,
        ),
      );

      if (children.length > 0) {
        nextNodes.push({
          ...node,
          children,
        });
      }
      continue;
    }

    nextNodes.push(node);
  }

  return nextNodes;
}

function toggleTextNodeMark(
  node: Text,
  startOffset: number,
  endOffset: number,
  mark: Mark,
  shouldRemove: boolean,
  path: string,
) {
  const beforeText = node.text.slice(0, startOffset);
  const selectedText = node.text.slice(startOffset, endOffset);
  const afterText = node.text.slice(endOffset);
  const selectedMarks = shouldRemove
    ? node.marks.filter((candidate) => candidate !== mark)
    : insertMark(node.marks, mark);

  return [
    createPathTextNode(beforeText, node.marks, `${path}.before`),
    createPathTextNode(selectedText, selectedMarks, `${path}.selected`),
    createPathTextNode(afterText, node.marks, `${path}.after`),
  ].filter(Boolean) as Text[];
}

function insertMark(marks: Mark[], mark: Mark) {
  return marks.includes(mark) ? marks : [...marks, mark].sort();
}
