import { resolvePresenceTargets, resolvePresenceViewport, type EditorPresence } from "@/editor";
import type { DocumentUserPresence } from "@/types";
import { createParameterizedSprig } from "./core/computed";
import { equalArrayBy, equalMapBy, equalNullable, equalNullableBy } from "./core/equality";
import { commentStateSprig } from "./editor/computed-sprigs";
import { documentIndexSprig } from "./editor/sprigs";
import { publishedViewportSprig } from "./viewport/sprigs";

/* Equality */

const equalCursorPoints = equalNullableBy<NonNullable<EditorPresence["cursorPoint"]>>((point) => [
  point.offset,
  point.regionId,
]);

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

const equalPresenceItem = (previous: EditorPresence, next: EditorPresence) => {
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
};

const equalPresenceItems = equalArrayBy(equalPresenceItem);

const equalPresence = equalNullable(equalPresenceItems);

/* Sprigs */

const presenceTargetsSprig = createParameterizedSprig(
  [documentIndexSprig],
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

export const resolvedPresenceSprig = createParameterizedSprig(
  [documentIndexSprig, publishedViewportSprig],
  (
    store,
    [userPresence]: readonly [DocumentUserPresence[] | undefined],
    documentIndex,
    viewport,
  ): EditorPresence[] | undefined => {
    const targets = presenceTargetsSprig.read(store, userPresence);

    if (!targets) {
      return undefined;
    }

    if (!viewport) {
      return targets;
    }

    const commentRanges = targets.some((presenceItem) => {
      return presenceItem.commentThreadIndex != null;
    })
      ? commentStateSprig.read(store).ranges
      : [];

    return resolvePresenceViewport(documentIndex, viewport, targets, commentRanges);
  },
  equalPresence,
);

export const commentPresenceSprig = createParameterizedSprig(
  [documentIndexSprig],
  (
    store,
    [userPresence]: readonly [DocumentUserPresence[] | undefined],
  ): ReadonlyMap<number, EditorPresence> => {
    const presence = presenceTargetsSprig.read(store, userPresence);
    const commentPresence = new Map<number, EditorPresence>();

    for (const presenceItem of presence ?? []) {
      if (
        presenceItem.commentThreadIndex != null &&
        !commentPresence.has(presenceItem.commentThreadIndex)
      ) {
        commentPresence.set(presenceItem.commentThreadIndex, presenceItem);
      }
    }

    return commentPresence;
  },
  equalMapBy<number, EditorPresence>(equalPresenceItem),
);
