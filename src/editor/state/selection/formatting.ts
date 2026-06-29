// Selection formatting query. This is intentionally read-only: it inspects the
// selected inline range so UI can show active formatting controls, but all
// formatting mutations stay in `state/commands/actions/inlines`.
//
// Implementation note: walks the flat `IndexedInline[]` produced by the index
// rather than re-traversing the document `Inline` tree. The index already
// flattened link wrappers (`IndexedInline.link` is orthogonal) and stamped
// `start`/`end` offsets, so this module is a simple range filter — no
// cursor-tracking, no per-type length re-derivation.

import type { Mark } from "@/document";
import { findInlinesInRange, regionInlines } from "../index/inlines";
import { isInlineRegion, resolveRegion } from "../index/query";
import type { IndexedInline } from "../index/types";
import type { EditorState } from "../types";
import { getSelectionRange } from "./query";

export type SelectionFormatting = {
  marks: readonly Mark[];
  supported: boolean;
};

export function getSelectionFormatting(state: EditorState): SelectionFormatting {
  const selectionRange = getSelectionRange(state);

  if (!selectionRange) {
    return emptySelectionFormatting();
  }

  const region = resolveRegion(state.documentIndex, selectionRange.regionPath);

  if (!region) {
    return emptySelectionFormatting();
  }

  if (!isInlineRegion(region)) {
    return {
      marks: [],
      supported: false,
    };
  }

  const inlines = regionInlines(region);

  if (inlines.length === 0) {
    return emptySelectionFormatting();
  }

  const selectedInlines = findInlinesInRange(
    inlines,
    selectionRange.startOffset,
    selectionRange.endOffset,
  );

  return {
    marks: resolveSelectionMarks(selectedInlines),
    supported: true,
  };
}

// The active mark set is the *intersection* of marks on every selected
// inline entry — a mark counts as "active" only when it applies to every
// text run in the selection. Non-text entries (images, mentions, line
// breaks) carry no marks and therefore force the intersection to be empty.
function resolveSelectionMarks(selectedInlines: readonly IndexedInline[]): Mark[] {
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

function emptySelectionFormatting(): SelectionFormatting {
  return {
    marks: [],
    supported: true,
  };
}
