import { resolvePresenceCursors, resolvePresenceViewport, type EditorPresence } from "@/editor";
import type { DocumentUserPresence } from "@/types";
import { createParameterizedStoreComputedValue } from "./core/computed";
import { equalArrayBy } from "./core/equality";
import { documentIndexValue } from "./editor/values";
import { publishedViewportValue } from "./viewport/values";

const presenceCursorsValue = createParameterizedStoreComputedValue(
  [documentIndexValue] as const,
  (
    _store,
    [userPresence]: readonly [DocumentUserPresence[] | undefined],
    documentIndex,
  ): EditorPresence[] | undefined => {
    if (!userPresence?.length) {
      return undefined;
    }

    return resolvePresenceCursors(documentIndex, userPresence);
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
    const cursors = presenceCursorsValue.read(store, userPresence);

    if (!cursors) {
      return undefined;
    }

    return viewport ? resolvePresenceViewport(documentIndex, viewport, cursors) : cursors;
  },
  equalPresence,
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
