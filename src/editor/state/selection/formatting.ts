// Selection formatting query. This is intentionally read-only: it inspects the
// selected inline range so UI can show active formatting controls, but all
// formatting mutations stay in `state/commands/actions/inlines`.

import { findBlockById, type Inline, type Mark } from "@/document";
import type { InlineContainer } from "../commands/inlines";
import { measureInlineNodeText, resolveInlineContainerFromBlock } from "../commands/inlines";
import type { EditorState } from "../types";
import { getSelectionRange } from "./query";

export type SelectionFormatting = {
  code: boolean;
  marks: readonly Mark[];
};

type InlineCodeState = {
  allCode: boolean;
  hasCode: boolean;
};

export function getSelectionFormatting(state: EditorState): SelectionFormatting {
  const selectionRange = getSelectionRange(state);

  if (!selectionRange) {
    return emptySelectionFormatting();
  }

  const region = state.documentIndex.regionIndex.get(selectionRange.regionId);

  if (!region) {
    return emptySelectionFormatting();
  }

  const block = findBlockById(state.documentIndex.document.blocks, region.blockId);

  if (!block) {
    return emptySelectionFormatting();
  }

  const inlineContainer = resolveInlineContainerFromBlock(
    block,
    region.path,
    region.semanticRegionId,
  );

  if (!inlineContainer) {
    return emptySelectionFormatting();
  }

  return resolveInlineSelectionFormatting(
    inlineContainer,
    selectionRange.startOffset,
    selectionRange.endOffset,
  );
}

function resolveInlineSelectionFormatting(
  inlineContainer: InlineContainer,
  startOffset: number,
  endOffset: number,
): SelectionFormatting {
  return {
    code: isInlineSelectionCode(inlineContainer, startOffset, endOffset),
    marks: resolveInlineMarks(inlineContainer, startOffset, endOffset),
  };
}

function resolveInlineMarks(
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

function isInlineSelectionCode(
  inlineContainer: InlineContainer,
  startOffset: number,
  endOffset: number,
): boolean {
  const state = collectInlineCodeState(inlineContainer.children, startOffset, endOffset);

  return state.hasCode && state.allCode;
}

function collectInlineCodeState(
  nodes: Inline[],
  startOffset: number,
  endOffset: number,
): InlineCodeState {
  const state: InlineCodeState = {
    allCode: true,
    hasCode: false,
  };
  let cursor = 0;

  for (const node of nodes) {
    const nodeLength = measureInlineNodeText(node);
    const nodeStart = cursor;
    const nodeEnd = nodeStart + nodeLength;
    cursor = nodeEnd;

    if (endOffset <= nodeStart || startOffset >= nodeEnd) {
      continue;
    }

    const overlapStart = Math.max(startOffset, nodeStart);
    const overlapEnd = Math.min(endOffset, nodeEnd);

    if (overlapEnd <= overlapStart) {
      continue;
    }

    if (node.type === "code") {
      state.hasCode = true;
      continue;
    }

    if (node.type === "link") {
      const nested = collectInlineCodeState(
        node.children,
        overlapStart - nodeStart,
        overlapEnd - nodeStart,
      );

      state.hasCode ||= nested.hasCode;
      state.allCode &&= nested.allCode;
      continue;
    }

    state.allCode = false;
  }

  return state;
}

function emptySelectionFormatting(): SelectionFormatting {
  return {
    code: false,
    marks: [],
  };
}
