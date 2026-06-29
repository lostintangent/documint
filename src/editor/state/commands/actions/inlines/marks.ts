// Mark toggling for any semantic document mark.
import {
  canonicalizeMarks,
  createText,
  defragmentTextInlines,
  type Inline,
  type Mark,
  type Text,
} from "@/document";
import { inlineNodesWithEditorRanges } from "@/editor/text/inline-offsets";
import {
  createInlineContainerReplacement,
  type InlineContainer,
  type InlineContainerReplacement,
} from "./shared";

export function toggleInlineMark(
  inlineContainer: InlineContainer,
  startOffset: number,
  endOffset: number,
  mark: Mark,
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

// Determines mark state across an outer-space range. Walks inline nodes
// recursively (link children are descended into) so an outer-space range
// that intersects nested marked text is detected correctly. Returns:
//   - `null` when the range contains no text at all (nothing to toggle).
//   - `true`  when every text run in the range carries `mark` (we should remove it).
//   - `false` when at least one text run lacks `mark` (we should apply it).
function shouldRemoveInlineMark(
  nodes: Inline[],
  startOffset: number,
  endOffset: number,
  mark: Mark,
) {
  let hasText = false;
  let allMarked = true;

  const visit = (candidates: Inline[], parentOffset: number) => {
    for (const { node, start, end } of inlineNodesWithEditorRanges(candidates)) {
      const nodeStart = parentOffset + start;
      const nodeEnd = parentOffset + end;

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
        // Link children are walked in outer coordinate space — pass the
        // link's outer start as the parent offset so child nodeStart /
        // nodeEnd match what we'd see if links were flattened.
        visit(node.children, nodeStart);
      }
    }
  };

  visit(nodes, 0);

  return hasText ? allMarked : null;
}

// Rewrites the marked range within `nodes`. Text nodes are split at the
// overlap boundaries and the overlapping slice gets the mark toggled.
// Links recurse with the overlap window translated into link-local
// coordinates (because rebuilding a link's children must produce
// link-local `Inline[]`).
function toggleInlineNodesMark(
  nodes: Inline[],
  startOffset: number,
  endOffset: number,
  mark: Mark,
  shouldRemove: boolean,
): Inline[] {
  const nextNodes: Inline[] = [];

  for (const { node, start, end } of inlineNodesWithEditorRanges(nodes)) {
    if (endOffset <= start || startOffset >= end) {
      nextNodes.push(node);
      continue;
    }

    const localStart = Math.max(0, startOffset - start);
    const localEnd = Math.min(end - start, endOffset - start);

    if (node.type === "text") {
      nextNodes.push(...toggleTextNodeMark(node, localStart, localEnd, mark, shouldRemove));
      continue;
    }

    if (node.type === "link") {
      const children = defragmentTextInlines(
        toggleInlineNodesMark(node.children, localStart, localEnd, mark, shouldRemove),
      );

      if (children.length > 0) {
        nextNodes.push({ ...node, children });
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
  return marks.includes(mark) ? marks : canonicalizeMarks([...marks, mark]);
}
