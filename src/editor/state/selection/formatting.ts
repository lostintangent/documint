// Selection formatting query. This is intentionally read-only: it inspects the
// selected inline range so UI can show active formatting controls, but all
// formatting mutations stay in `state/commands/actions/inlines`.
//
// Implementation note: walks the flat `InlineEntry[]` produced by the index
// rather than re-traversing the document `Inline` tree. The index already
// flattened link wrappers (`InlineEntry.link` is orthogonal) and stamped
// `start`/`end` offsets, so this module is a simple range filter — no
// cursor-tracking, no per-type length re-derivation.

import type { Mark } from "@/document";
import { findInlinesInSpan, regionInlines } from "../index/inlines";
import { isInlineTextRegion, resolveRegion } from "../index/query";
import type { InlineEntry } from "../index/types";
import type { EditorState } from "../types";
import { getSelectionRange } from "./query";

export type SelectionFormatting = {
  code: boolean;
  marks: readonly Mark[];
  supported: boolean;
};

export function getSelectionFormatting(state: EditorState): SelectionFormatting {
  const selectionRange = getSelectionRange(state);

  if (!selectionRange) {
    return emptySelectionFormatting();
  }

  const region = resolveRegion(state.documentIndex, selectionRange.regionId);

  if (!region) {
    return emptySelectionFormatting();
  }

  if (!isInlineTextRegion(region)) {
    return {
      code: false,
      marks: [],
      supported: false,
    };
  }

  const inlines = regionInlines(region);

  if (inlines.length === 0) {
    return emptySelectionFormatting();
  }

  const selectedInlines = findInlinesInSpan(
    inlines,
    selectionRange.startOffset,
    selectionRange.endOffset,
  );

  return {
    code: isSelectionInlineCode(selectedInlines),
    marks: resolveSelectionMarks(selectedInlines),
    supported: true,
  };
}

// The active mark set is the *intersection* of marks on every selected
// inline entry — a mark counts as "active" only when it applies to every
// text run in the selection. Non-text entries (images, mentions, line
// breaks, inline code) carry no marks and therefore force the intersection
// to be empty.
function resolveSelectionMarks(selectedInlines: readonly InlineEntry[]): Mark[] {
  let commonMarks: Set<Mark> | null = null;

  for (const inline of selectedInlines) {
    if (inline.node.type !== "text") {
      return [];
    }

    if (commonMarks === null) {
      commonMarks = new Set(inline.node.marks);
      continue;
    }

    for (const mark of commonMarks) {
      if (!inline.node.marks.includes(mark)) {
        commonMarks.delete(mark);
      }
    }
  }

  return commonMarks ? [...commonMarks] : [];
}

// Inline code is "active" when at least one inline-code node overlaps the
// selection AND every non-empty selected entry is inline code. Mirrors the
// previous per-walk logic: any non-code text breaks the all-code condition.
function isSelectionInlineCode(selectedInlines: readonly InlineEntry[]): boolean {
  let hasCode = false;
  for (const inline of selectedInlines) {
    if (inline.node.type === "code") {
      hasCode = true;
      continue;
    }
    return false;
  }
  return hasCode;
}

function emptySelectionFormatting(): SelectionFormatting {
  return {
    code: false,
    marks: [],
    supported: true,
  };
}
