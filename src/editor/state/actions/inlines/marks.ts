// Mark toggling: bold, italic, strikethrough, underline.
import { createText, defragmentTextInlines, type Inline, type Mark, type Text } from "@/document";
import {
  createInlineContainerReplacement,
  measureInlineNodeText,
  type InlineContainer,
  type InlineContainerReplacement,
} from "./shared";

export function toggleInlineMark(
  inlineContainer: InlineContainer,
  startOffset: number,
  endOffset: number,
  mark: Extract<Mark, "italic" | "bold" | "strikethrough" | "underline">,
): InlineContainerReplacement | null {
  const removeMark = shouldRemoveInlineMark(inlineContainer.children, startOffset, endOffset, mark);

  if (removeMark === null) {
    return null;
  }

  const nextChildren = defragmentTextInlines(
    toggleInlineNodesMark(inlineContainer.children, startOffset, endOffset, mark, removeMark),
  );

  return nextChildren.length > 0
    ? createInlineContainerReplacement(inlineContainer, nextChildren, startOffset, endOffset)
    : null;
}

export function resolveInlineMarks(
  inlineContainer: InlineContainer,
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

  visit(inlineContainer.children);

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
): Inline[] {
  const nextNodes: Inline[] = [];
  let cursor = 0;

  for (const node of nodes) {
    const nodeStart = cursor;
    const nodeLength = measureInlineNodeText(node);
    const nodeEnd = nodeStart + nodeLength;

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
        ),
      );
      continue;
    }

    if (node.type === "link") {
      const children = defragmentTextInlines(
        toggleInlineNodesMark(
          node.children,
          Math.max(0, startOffset - nodeStart),
          Math.min(nodeLength, endOffset - nodeStart),
          mark,
          shouldRemove,
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
) {
  const beforeText = node.text.slice(0, startOffset);
  const selectedText = node.text.slice(startOffset, endOffset);
  const afterText = node.text.slice(endOffset);
  const selectedMarks = shouldRemove
    ? node.marks.filter((candidate) => candidate !== mark)
    : insertMark(node.marks, mark);

  const segments: Text[] = [];
  const pushSegment = (text: string, marks: Mark[]) => {
    if (text.length > 0) {
      segments.push(createText(text, marks));
    }
  };
  pushSegment(beforeText, node.marks);
  pushSegment(selectedText, selectedMarks);
  pushSegment(afterText, node.marks);
  return segments;
}

function insertMark(marks: Mark[], mark: Mark) {
  return marks.includes(mark) ? marks : [...marks, mark].sort();
}
