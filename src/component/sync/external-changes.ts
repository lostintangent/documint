import {
  documentChangeLocationKey,
  hasSameDocumentChangeTargetEvidence,
  retargetDocumentChanges,
  type DocumentChange,
} from "@/document";
import {
  resolveIndexedBlock,
  resolveRegion,
  resolveRegionByPath,
  selectionIntersectsBlock,
  selectionIntersectsRegion,
  type EditorState,
} from "@/editor/state";
import type { ResolvedDocumentChangeTarget } from "@/types";

export type UnacknowledgedDocumentChange = {
  change: DocumentChange;
  editorTarget: ResolvedDocumentChangeTarget;
};

export type UnacknowledgedDocumentChangeMerge = {
  changes: readonly UnacknowledgedDocumentChange[];
  newChanges: readonly UnacknowledgedDocumentChange[];
};

export function acknowledgeUnacknowledgedDocumentChanges(
  current: readonly UnacknowledgedDocumentChange[],
  state: EditorState,
  options: { retarget?: boolean } = {},
): readonly UnacknowledgedDocumentChange[] {
  if (current.length === 0) {
    return current;
  }

  const changes: UnacknowledgedDocumentChange[] = [];
  let didChange = false;
  const shouldRetargetMissingTargets = options.retarget ?? false;
  const changesToRetarget: DocumentChange[] = [];
  const retargetInsertionIndexes: number[] = [];

  for (const [index, change] of current.entries()) {
    const retained = retainVisibleUnacknowledgedDocumentChange(
      change,
      state,
    );

    if (retained) {
      changes.push(retained);
      continue;
    }

    if (
      shouldRetargetMissingTargets &&
      !isSelectionOnDocumentChangeTarget(state, change.editorTarget)
    ) {
      changesToRetarget.push(change.change);
      retargetInsertionIndexes.push(index);
    } else {
      didChange = true;
    }
  }

  if (changesToRetarget.length > 0) {
    const retargeted = retargetUnacknowledgedDocumentChanges(
      changesToRetarget,
      state,
    );

    for (const [index, retargetedChange] of retargeted.entries()) {
      if (retargetedChange) {
        changes.splice(retargetInsertionIndexes[index]!, 0, retargetedChange);
      } else {
        didChange = true;
      }
    }

    didChange = true;
  }

  return !didChange && changes.length === current.length ? current : changes;
}

export function mergeUnacknowledgedDocumentChanges(
  current: readonly UnacknowledgedDocumentChange[],
  changes: readonly DocumentChange[],
  state: EditorState,
): UnacknowledgedDocumentChangeMerge {
  const byKey = new Map<string, UnacknowledgedDocumentChange>();
  const consumedIncoming = new Set<number>();
  const resolvedIncoming = resolveIncomingDocumentChanges(changes, state);
  const resolvedCurrent = retargetUnacknowledgedDocumentChanges(
    current.map((change) => change.change),
    state,
  );
  const newChanges: UnacknowledgedDocumentChange[] = [];

  for (const [index, active] of current.entries()) {
    const retargeted = resolvedCurrent[index] ?? null;
    if (retargeted) {
      consumeIncomingForExistingTarget(
        retargeted,
        resolvedIncoming,
        consumedIncoming,
      );
      byKey.set(
        documentChangeLocationKey(retargeted.change.target),
        retargeted,
      );
      continue;
    }

    const refreshed = refreshExistingDocumentChange(
      active,
      resolvedIncoming,
      consumedIncoming,
    );
    if (refreshed) {
      byKey.set(documentChangeLocationKey(refreshed.change.target), refreshed);
    }
  }

  for (const [index, unacknowledgedChange] of resolvedIncoming.entries()) {
    if (consumedIncoming.has(index)) {
      continue;
    }

    if (unacknowledgedChange) {
      byKey.set(
        documentChangeLocationKey(unacknowledgedChange.change.target),
        unacknowledgedChange,
      );
      newChanges.push(unacknowledgedChange);
    }
  }

  return {
    changes: [...byKey.values()],
    newChanges,
  };
}

function retainVisibleUnacknowledgedDocumentChange(
  change: UnacknowledgedDocumentChange,
  state: EditorState,
): UnacknowledgedDocumentChange | null {
  return isResolvedDocumentChangeTargetPresent(state, change.editorTarget) &&
    !isSelectionOnDocumentChangeTarget(state, change.editorTarget)
    ? change
    : null;
}

function isResolvedDocumentChangeTargetPresent(
  state: EditorState,
  target: ResolvedDocumentChangeTarget,
) {
  return target.kind === "block"
    ? resolveIndexedBlock(state.documentIndex, target.blockId) !== null
    : resolveRegion(state.documentIndex, target.regionId) !== null;
}

function resolveIncomingDocumentChanges(
  changes: readonly DocumentChange[],
  state: EditorState,
): readonly (UnacknowledgedDocumentChange | null)[] {
  return changes.map((change) => resolveVisibleDocumentChange(change, state));
}

function retargetUnacknowledgedDocumentChanges(
  changes: readonly DocumentChange[],
  state: EditorState,
): readonly (UnacknowledgedDocumentChange | null)[] {
  const retargetedChanges = retargetDocumentChanges(
    state.documentIndex.document,
    changes,
  );
  return retargetedChanges.map((change) =>
    change ? resolveVisibleDocumentChange(change, state) : null,
  );
}

function resolveVisibleDocumentChange(
  change: DocumentChange,
  state: EditorState,
): UnacknowledgedDocumentChange | null {
  const target = resolveDocumentChangeTarget(state, change);
  if (!target || isSelectionOnDocumentChangeTarget(state, target)) {
    return null;
  }

  return {
    change,
    editorTarget: target,
  };
}

function consumeIncomingForExistingTarget(
  active: UnacknowledgedDocumentChange,
  incoming: readonly (UnacknowledgedDocumentChange | null)[],
  consumedIncoming: Set<number>,
) {
  for (const [index, candidate] of incoming.entries()) {
    if (
      !candidate ||
      consumedIncoming.has(index) ||
      !hasSameResolvedDocumentChangeTarget(
        active.editorTarget,
        candidate.editorTarget,
      )
    ) {
      continue;
    }

    consumedIncoming.add(index);
    return;
  }
}

function refreshExistingDocumentChange(
  active: UnacknowledgedDocumentChange,
  incoming: readonly (UnacknowledgedDocumentChange | null)[],
  consumedIncoming: Set<number>,
): UnacknowledgedDocumentChange | null {
  for (const [index, candidate] of incoming.entries()) {
    if (
      !candidate ||
      consumedIncoming.has(index) ||
      candidate.change.changeKind !== "modified" ||
      !hasSameDocumentChangeTargetEvidence(
        active.change.target,
        candidate.change.previousTarget,
      )
    ) {
      continue;
    }

    consumedIncoming.add(index);
    return active.change.changeKind === "added"
      ? {
          change: {
            changeKind: "added",
            target: candidate.change.target,
          },
          editorTarget: candidate.editorTarget,
        }
      : {
          change: {
            changeKind: "modified",
            previousTarget: active.change.previousTarget,
            target: candidate.change.target,
          },
          editorTarget: candidate.editorTarget,
        };
  }

  return null;
}

function resolveDocumentChangeTarget(
  state: EditorState,
  change: DocumentChange,
): ResolvedDocumentChangeTarget | null {
  if (change.target.kind === "block") {
    return resolveIndexedBlock(state.documentIndex, change.target.node.blockId)
      ? {
          blockId: change.target.node.blockId,
          kind: "block",
        }
      : null;
  }

  const region = resolveRegionByPath(
    state.documentIndex,
    change.target.node.path,
  );
  return region
    ? {
        kind: "table-cell",
        regionId: region.id,
      }
    : null;
}

function isSelectionOnDocumentChangeTarget(
  state: EditorState,
  target: ResolvedDocumentChangeTarget,
) {
  return target.kind === "block"
    ? selectionIntersectsBlock(state, target.blockId)
    : selectionIntersectsRegion(state, target.regionId);
}

function hasSameResolvedDocumentChangeTarget(
  left: ResolvedDocumentChangeTarget,
  right: ResolvedDocumentChangeTarget,
) {
  if (left.kind !== right.kind) {
    return false;
  }

  if (left.kind === "block" && right.kind === "block") {
    return left.blockId === right.blockId;
  }

  if (left.kind === "table-cell" && right.kind === "table-cell") {
    return left.regionId === right.regionId;
  }

  return false;
}
