import {
  documentNodeAnchorKey,
  documentNodeAnchorLocationKey,
  type DocumentChange,
} from "@/document";
import { resolveNodeAnchors, type EditorNodeAnchor } from "@/editor/anchors";
import {
  selectionIntersectsBlockPath,
  selectionIntersectsPath,
  type EditorState,
} from "@/editor/state";

export type UnacknowledgedDocumentChange = DocumentChange & {
  // Stable lifecycle identity for animation and merge bookkeeping.
  changeKey: string;
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
    active: UnacknowledgedDocumentChange;
    anchorMatch: EditorNodeAnchor;
    index: number;
  }[] = [];
  const anchorMatches = resolveChangeAnchorMatches(state, current);

  for (const [index, change] of current.entries()) {
    const anchorMatch = anchorMatches[index] ?? { status: "unmatched" };
    const currentChange = resolveDocumentChange(change, anchorMatch, false);
    const retained =
      currentChange && !isSelectionOnDocumentChange(state, currentChange) ? change : null;

    if (retained) {
      changes[index] = retained;
      continue;
    }

    if (shouldRetargetMissingTargets && !currentChange) {
      changesToRetarget.push({
        active: change,
        anchorMatch,
        index,
      });
    } else {
      didChange = true;
    }
  }

  if (changesToRetarget.length > 0) {
    for (const candidate of changesToRetarget) {
      const retargetedChange = resolveVisibleDocumentChange(
        candidate.active,
        state,
        candidate.anchorMatch,
        {
          changeKey: candidate.active.changeKey,
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

  return !didChange && compactedChanges.length === current.length ? current : compactedChanges;
}

export function mergeUnacknowledgedDocumentChanges(
  current: readonly UnacknowledgedDocumentChange[],
  changes: readonly DocumentChange[],
  state: EditorState,
): UnacknowledgedDocumentChangeMerge {
  const byKey = new Map<string, UnacknowledgedDocumentChange>();
  const consumedIncoming = new Set<number>();
  const resolvedIncoming = resolveIncomingDocumentChanges(changes, state);
  const resolvedCurrent = retargetUnacknowledgedDocumentChanges(current, state);
  const newChanges: UnacknowledgedDocumentChange[] = [];

  for (const [index, active] of current.entries()) {
    const retargeted = resolvedCurrent[index] ?? null;
    if (retargeted) {
      consumeIncomingForExistingTarget(retargeted, resolvedIncoming, consumedIncoming);
      byKey.set(documentNodeAnchorLocationKey(retargeted.anchor), retargeted);
      continue;
    }

    const refreshed = refreshExistingDocumentChange(active, resolvedIncoming, consumedIncoming);
    if (refreshed) {
      byKey.set(documentNodeAnchorLocationKey(refreshed.anchor), refreshed);
    }
  }

  for (const [index, unacknowledgedChange] of resolvedIncoming.entries()) {
    if (consumedIncoming.has(index)) {
      continue;
    }

    if (unacknowledgedChange) {
      byKey.set(documentNodeAnchorLocationKey(unacknowledgedChange.anchor), unacknowledgedChange);
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
  return resolveVisibleDocumentChanges(changes, state, {
    changeKeys: changes.map((change) => change.changeKey),
    retarget: true,
  });
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
    resolveVisibleDocumentChange(change, state, anchorMatches[index] ?? { status: "unmatched" }, {
      changeKey: options.changeKeys?.[index] ?? documentNodeAnchorKey(change.anchor),
      retarget: options.retarget,
    }),
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
  const resolvedChange = resolveDocumentChange(change, anchorMatch, options.retarget);
  if (!resolvedChange || isSelectionOnDocumentChange(state, resolvedChange)) {
    return null;
  }

  return {
    ...resolvedChange,
    changeKey: options.changeKey,
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
      documentNodeAnchorLocationKey(active.anchor) !==
        documentNodeAnchorLocationKey(candidate.anchor)
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
  if (active.kind === "deleted") {
    return null;
  }

  for (const [index, candidate] of incoming.entries()) {
    if (
      !candidate ||
      consumedIncoming.has(index) ||
      candidate.kind !== "modified" ||
      documentNodeAnchorKey(active.anchor) !== documentNodeAnchorKey(candidate.previousAnchor)
    ) {
      continue;
    }

    consumedIncoming.add(index);
    return active.kind === "added"
      ? {
          anchor: candidate.anchor,
          changeKey: active.changeKey,
          kind: "added",
        }
      : {
          anchor: candidate.anchor,
          changeKey: active.changeKey,
          kind: "modified",
          previousAnchor: active.previousAnchor,
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
    changes.map((change) => change.anchor),
  );

  return changes.map(
    (change) =>
      matches.get(documentNodeAnchorKey(change.anchor)) ?? {
        status: "unmatched",
      },
  );
}

function resolveDocumentChange(
  change: DocumentChange,
  anchorMatch: EditorNodeAnchor,
  retarget: boolean,
): DocumentChange | null {
  if (
    anchorMatch.status !== "matched" ||
    anchorMatch.anchor.kind !== change.anchor.kind ||
    (!retarget && anchorMatch.path !== change.anchor.path)
  ) {
    return null;
  }

  return retarget ? retargetDocumentChange(change, anchorMatch) : change;
}

function retargetDocumentChange(
  change: DocumentChange,
  anchorMatch: EditorNodeAnchor,
): DocumentChange {
  if (anchorMatch.status !== "matched") {
    throw new Error("Expected matched document change anchor");
  }

  return { ...change, anchor: anchorMatch.anchor };
}

function isSelectionOnDocumentChange(state: EditorState, change: DocumentChange) {
  return change.anchor.kind === "block"
    ? selectionIntersectsBlockPath(state, change.anchor.path)
    : selectionIntersectsPath(state, change.anchor.path);
}
