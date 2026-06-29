import {
  documentChangeLocationKey,
  documentChangeTargetAnchorKey,
  hasSameDocumentChangeTargetAnchor,
  type DocumentChange,
  type DocumentChangeTarget,
} from "@/document";
import { resolveNodeAnchors, type EditorNodeAnchor } from "@/editor/anchors";
import {
  selectionIntersectsBlockPath,
  selectionIntersectsRegion,
  type EditorState,
} from "@/editor/state";
import type { ResolvedDocumentChangeTarget } from "@/types";

export type UnacknowledgedDocumentChange = {
  change: DocumentChange;
  // Stable lifecycle identity for animation and merge bookkeeping. The
  // `editorTarget` is the current path projection and may retarget.
  changeKey: string;
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

  const changes = Array.from<UnacknowledgedDocumentChange | null>({
    length: current.length,
  }).fill(null);
  let didChange = false;
  const shouldRetargetMissingTargets = options.retarget ?? false;
  const changesToRetarget: {
    anchorMatch: EditorNodeAnchor;
    change: UnacknowledgedDocumentChange;
    index: number;
  }[] = [];
  const anchorMatches = resolveChangeAnchorMatches(
    state,
    current.map((change) => change.change),
  );

  for (const [index, change] of current.entries()) {
    const anchorMatch = anchorMatches[index] ?? { status: "unmatched" };
    const currentTarget = verifyStoredEditorChangeTarget(
      change.change,
      anchorMatch,
    );
    const retained =
      currentTarget && !isSelectionOnDocumentChangeTarget(state, currentTarget)
        ? { ...change, editorTarget: currentTarget }
        : null;

    if (retained) {
      changes[index] = retained;
      continue;
    }

    if (shouldRetargetMissingTargets && !currentTarget) {
      changesToRetarget.push({
        anchorMatch,
        change,
        index,
      });
    } else {
      didChange = true;
    }
  }

  if (changesToRetarget.length > 0) {
    for (const candidate of changesToRetarget) {
      const retargetedChange = resolveVisibleDocumentChange(
        candidate.change.change,
        state,
        candidate.anchorMatch,
        {
          changeKey: candidate.change.changeKey,
          retarget: true,
        },
      );
      if (retargetedChange) {
        changes[candidate.index] = retargetedChange;
      } else {
        didChange = true;
      }
    }

    didChange = true;
  }

  const compactedChanges = changes.filter((change) => change !== null);

  return !didChange && compactedChanges.length === current.length
    ? current
    : compactedChanges;
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
    current,
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

function resolveIncomingDocumentChanges(
  changes: readonly DocumentChange[],
  state: EditorState,
): readonly (UnacknowledgedDocumentChange | null)[] {
  return resolveVisibleDocumentChanges(changes, state, { retarget: false });
}

function retargetUnacknowledgedDocumentChanges(
  changes: readonly UnacknowledgedDocumentChange[],
  state: EditorState,
): readonly (UnacknowledgedDocumentChange | null)[] {
  return resolveVisibleDocumentChanges(
    changes.map((change) => change.change),
    state,
    {
      changeKeys: changes.map((change) => change.changeKey),
      retarget: true,
    },
  );
}

function resolveVisibleDocumentChanges(
  changes: readonly DocumentChange[],
  state: EditorState,
  options: {
    readonly changeKeys?: readonly string[];
    readonly retarget: boolean;
  },
): readonly (UnacknowledgedDocumentChange | null)[] {
  const anchorMatches = resolveChangeAnchorMatches(state, changes);

  return changes.map((change, index) =>
    resolveVisibleDocumentChange(
      change,
      state,
      anchorMatches[index] ?? { status: "unmatched" },
      {
        changeKey:
          options.changeKeys?.[index] ??
          documentChangeTargetAnchorKey(change.target),
        retarget: options.retarget,
      },
    ),
  );
}

function resolveVisibleDocumentChange(
  change: DocumentChange,
  state: EditorState,
  anchorMatch: EditorNodeAnchor,
  options: {
    readonly changeKey: string;
    readonly retarget: boolean;
  },
): UnacknowledgedDocumentChange | null {
  const target = options.retarget
    ? resolveRetargetedEditorChangeTarget(change, anchorMatch)
    : verifyStoredEditorChangeTarget(change, anchorMatch);
  if (!target || isSelectionOnDocumentChangeTarget(state, target)) {
    return null;
  }

  return {
    change: options.retarget
      ? retargetDocumentChange(change, anchorMatch)
      : change,
    changeKey: options.changeKey,
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
      !hasSameDocumentChangeTargetAnchor(
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
          changeKey: active.changeKey,
          editorTarget: candidate.editorTarget,
        }
      : {
          change: {
            changeKind: "modified",
            previousTarget: active.change.previousTarget,
            target: candidate.change.target,
          },
          changeKey: active.changeKey,
          editorTarget: candidate.editorTarget,
        };
  }

  return null;
}

function resolveChangeAnchorMatches(
  state: EditorState,
  changes: readonly DocumentChange[],
): readonly EditorNodeAnchor[] {
  const matches = resolveNodeAnchors(
    state.documentIndex,
    changes.map((change) => change.target.anchor),
  );

  return changes.map(
    (change) =>
      matches.get(documentChangeTargetAnchorKey(change.target)) ?? {
        status: "unmatched",
      },
  );
}

function verifyStoredEditorChangeTarget(
  change: DocumentChange,
  anchorMatch: EditorNodeAnchor,
): ResolvedDocumentChangeTarget | null {
  if (anchorMatch.status !== "matched" || anchorMatch.path !== change.target.path) {
    return null;
  }

  return resolveMatchedEditorChangeTarget(change, anchorMatch);
}

function resolveRetargetedEditorChangeTarget(
  change: DocumentChange,
  anchorMatch: EditorNodeAnchor,
): ResolvedDocumentChangeTarget | null {
  return resolveMatchedEditorChangeTarget(change, anchorMatch);
}

function resolveMatchedEditorChangeTarget(
  change: DocumentChange,
  anchorMatch: EditorNodeAnchor,
): ResolvedDocumentChangeTarget | null {
  if (
    anchorMatch.status !== "matched" ||
    anchorMatch.anchor.kind !== change.target.kind
  ) {
    return null;
  }

  if (change.target.kind === "block") {
    return {
      blockPath: anchorMatch.path,
      kind: "block",
    };
  }

  return anchorMatch.region
    ? {
        kind: "table-cell",
        regionPath: anchorMatch.region.path,
      }
    : null;
}

function retargetDocumentChange(
  change: DocumentChange,
  anchorMatch: EditorNodeAnchor,
): DocumentChange {
  if (anchorMatch.status !== "matched") {
    throw new Error("Expected matched document change anchor");
  }

  const target = documentChangeTargetFromAnchorMatch(anchorMatch);

  if (change.changeKind === "added") {
    return {
      changeKind: "added",
      target,
    };
  }

  return {
    changeKind: "modified",
    previousTarget: change.previousTarget,
    target,
  };
}

function documentChangeTargetFromAnchorMatch(
  anchorMatch: Extract<EditorNodeAnchor, { status: "matched" }>,
): DocumentChangeTarget {
  if (anchorMatch.anchor.kind === "block") {
    return {
      anchor: anchorMatch.anchor,
      kind: "block",
      path: anchorMatch.path,
    };
  }

  return {
    anchor: anchorMatch.anchor,
    kind: "table-cell",
    path: anchorMatch.path,
  };
}

function isSelectionOnDocumentChangeTarget(
  state: EditorState,
  target: ResolvedDocumentChangeTarget,
) {
  return target.kind === "block"
    ? selectionIntersectsBlockPath(state, target.blockPath)
    : selectionIntersectsRegion(state, target.regionPath);
}

function hasSameResolvedDocumentChangeTarget(
  left: ResolvedDocumentChangeTarget,
  right: ResolvedDocumentChangeTarget,
) {
  if (left.kind !== right.kind) {
    return false;
  }

  if (left.kind === "block" && right.kind === "block") {
    return left.blockPath === right.blockPath;
  }

  if (left.kind === "table-cell" && right.kind === "table-cell") {
    return left.regionPath === right.regionPath;
  }

  return false;
}
