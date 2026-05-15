import { resolvePresenceTargets, resolvePresenceViewport, type EditorPresence } from "@/editor";
import type { DocumentUserPresence } from "@/types";
import { createParameterizedStoreComputedValue } from "./core/computed";
import { equalArrayBy } from "./core/equality";
import { documentIndexValue } from "./editor/values";
import { publishedViewportValue } from "./viewport/values";

const presenceTargetsValue = createParameterizedStoreComputedValue(
  [documentIndexValue] as const,
  (
    _store,
    [userPresence]: readonly [DocumentUserPresence[] | undefined],
    documentIndex,
  ): EditorPresence[] | undefined => {
    if (!userPresence?.length) {
      return undefined;
    }

    return resolvePresenceTargets(documentIndex, userPresence);
  },
  equalPresence,
);

export const presenceValue = createParameterizedStoreComputedValue(
  [documentIndexValue, publishedViewportValue] as const,
  (
    store,
    [userPresence]: readonly [DocumentUserPresence[] | undefined],
    documentIndex,
    viewport,
  ): EditorPresence[] | undefined => {
    const targets = presenceTargetsValue.read(store, userPresence);

    if (!targets) {
      return undefined;
    }

    return viewport ? resolvePresenceViewport(documentIndex, viewport, targets) : targets;
  },
  equalPresence,
);

export const presenceActiveCommentThreadColorsValue = createParameterizedStoreComputedValue(
  [documentIndexValue] as const,
  (
    store,
    [userPresence]: readonly [DocumentUserPresence[] | undefined],
  ): ReadonlyMap<number, string | null> => {
    const presence = presenceTargetsValue.read(store, userPresence);
    const activeThreadColors = new Map<number, string | null>();

    for (const presenceItem of presence ?? []) {
      if (
        presenceItem.commentThreadIndex != null &&
        !activeThreadColors.has(presenceItem.commentThreadIndex)
      ) {
        activeThreadColors.set(presenceItem.commentThreadIndex, presenceItem.color ?? null);
      }
    }

    return activeThreadColors;
  },
  equalNumberStringMaps,
);

function equalPresence(previous: EditorPresence[] | undefined, next: EditorPresence[] | undefined) {
  if (previous === next) return true;
  if (!previous || !next) return false;
  return equalPresenceItems(previous, next);
}

const equalPresenceItems = equalArrayBy((previous: EditorPresence, next: EditorPresence) => {
  return (
    previous.id === next.id &&
    previous.username === next.username &&
    previous.fullName === next.fullName &&
    previous.avatarUrl === next.avatarUrl &&
    previous.color === next.color &&
    previous.commentThreadIndex === next.commentThreadIndex &&
    equalCursorPoints(previous.cursorPoint, next.cursorPoint) &&
    equalPresenceViewports(previous.viewport, next.viewport)
  );
});

function equalCursorPoints(
  previous: EditorPresence["cursorPoint"],
  next: EditorPresence["cursorPoint"],
) {
  if (previous === next) return true;
  if (!previous || !next) return false;
  return previous.offset === next.offset && previous.regionId === next.regionId;
}

function equalPresenceViewports(
  previous: EditorPresence["viewport"],
  next: EditorPresence["viewport"],
) {
  if (previous === next) return true;
  if (!previous || !next) return false;
  if (previous.status !== next.status) return false;

  if (previous.status === "unresolved") {
    return true;
  }

  return next.status !== "unresolved" && previous.scrollTop === next.scrollTop;
}

function equalNumberStringMaps(
  previous: ReadonlyMap<number, string | null>,
  next: ReadonlyMap<number, string | null>,
) {
  if (previous === next) return true;
  if (previous.size !== next.size) return false;

  for (const [key, value] of previous) {
    if (next.get(key) !== value) {
      return false;
    }
  }

  return true;
}
