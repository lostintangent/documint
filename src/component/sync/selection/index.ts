/**
 * Selection reconciliation for external content snapshots. Keeps focus sticky
 * across a rebuilt editor state without entering the local editing
 * action-dispatch path.
 *
 * Reconciles:
 *   - equivalent selections across stable, moved, or edited text paths
 *   - cursor/range offsets when text is inserted or deleted around the selection
 *   - transient empty root paragraphs that markdown rebuilds cannot represent
 *
 * Intentionally does not attempt full document rebase. Ambiguous duplicate
 * paths, structural rewrites, nested empty blocks, and deleted selection
 * endpoints fall back to the caller's reload behavior.
 */

import {
  areSelectionPointsEqual,
  compareEditorPositions,
  resolveEditorTextAtPath,
  setSelection,
  type EditorSelection,
  type EditorSelectionPoint,
  type EditorState,
} from "@/editor/state";
import {
  createSelectionAnchor,
  resolveSelectionAnchor,
  type SelectionAnchorAffinity,
} from "@/editor/anchors";
import { resolveExternalPathMatch } from "./path-match";
import { restoreTransientEmptyRootParagraphSelection } from "./empty-paragraph";

export type ExternalSelectionReconciliationResult = {
  didReconcile: boolean;
  state: EditorState;
};

export function reconcileExternalContentChange(
  previousState: EditorState | null,
  nextState: EditorState,
): ExternalSelectionReconciliationResult {
  if (!previousState) {
    return { didReconcile: false, state: nextState };
  }

  // Prefer semantic path/offset repair. Recreate transient empty paragraphs
  // only when normal selection reconciliation cannot find an equivalent point.
  const restoredState =
    restoreEquivalentSelection(previousState, nextState) ??
    restoreTransientEmptyRootParagraphSelection(previousState, nextState);

  return restoredState
    ? { didReconcile: true, state: restoredState }
    : { didReconcile: false, state: nextState };
}

// Apply the equivalent selection (if any) to `nextState`. Exposed so tests
// can observe the post-rebase selection without re-running the whole
// reconcile.
export function restoreEquivalentSelection(
  previousState: EditorState,
  nextState: EditorState,
): EditorState | null {
  const equivalentSelection = resolveEquivalentSelection(previousState, nextState);

  return equivalentSelection ? setSelection(nextState, equivalentSelection, false) : null;
}

// Compute the selection in `nextState` that semantically matches the
// selection in `previousState`. Returns `null` when either endpoint cannot
// be unambiguously placed, signaling the caller to fall back.
export function resolveEquivalentSelection(
  previousState: EditorState,
  nextState: EditorState,
): EditorSelection | null {
  if (areSelectionPointsEqual(previousState.selection.anchor, previousState.selection.focus)) {
    const point = resolveEquivalentSelectionPoint(
      previousState,
      nextState,
      previousState.selection.focus,
      "neutral",
    );

    return point ? { anchor: point, focus: point } : null;
  }

  const selectionAffinity = resolveSelectionPointAffinity(previousState);
  const anchor = resolveEquivalentSelectionPoint(
    previousState,
    nextState,
    previousState.selection.anchor,
    selectionAffinity.anchor,
  );
  const focus = resolveEquivalentSelectionPoint(
    previousState,
    nextState,
    previousState.selection.focus,
    selectionAffinity.focus,
  );

  return anchor && focus ? { anchor, focus } : null;
}

function resolveEquivalentSelectionPoint(
  previousState: EditorState,
  nextState: EditorState,
  point: EditorSelectionPoint,
  affinity: SelectionAnchorAffinity,
): EditorSelectionPoint | null {
  const previousText = resolveEditorTextAtPath(previousState.documentIndex, point.path);

  if (previousText === null) {
    return null;
  }

  const selectionAnchor = createSelectionAnchor(previousText, point.offset, affinity);
  const nextPath = resolveExternalPathMatch(
    previousState,
    point.path,
    previousText,
    nextState,
    selectionAnchor,
  );
  const nextText = nextPath ? resolveEditorTextAtPath(nextState.documentIndex, nextPath) : null;

  if (nextText === null || !nextPath) {
    return null;
  }

  return {
    offset: resolveSelectionAnchor(nextText, selectionAnchor).offset,
    path: nextPath,
  };
}

function resolveSelectionPointAffinity(state: EditorState): {
  anchor: SelectionAnchorAffinity;
  focus: SelectionAnchorAffinity;
} {
  const { anchor, focus } = state.selection;

  if (areSelectionPointsEqual(anchor, focus)) {
    return {
      anchor: "neutral",
      focus: "neutral",
    };
  }

  // Range starts should stay before the selected text; range ends should stay
  // after it. Reverse selections preserve the user's original anchor/focus.
  return compareSelectionPoints(state, anchor, focus) <= 0
    ? {
        anchor: "before-suffix",
        focus: "after-prefix",
      }
    : {
        anchor: "after-prefix",
        focus: "before-suffix",
      };
}

function compareSelectionPoints(
  state: EditorState,
  left: EditorSelectionPoint,
  right: EditorSelectionPoint,
) {
  return compareEditorPositions(state.documentIndex, left, right, { unknown: "before" });
}
