import { resolvePresenceTargets, resolvePresenceViewport, type EditorPresence } from "@/editor";
import type { DocumentUserPresence } from "@/types";
import { createParameterizedSprig } from "./core/computed";
import {
  equalArrayBy,
  equalMapBy,
  equalNullable,
  equalSelectionPoints,
  equalShallowObject,
} from "./core/equality";
import { commentStateSprig } from "./editor/computed-sprigs";
import { documentIndexSprig } from "./editor/sprigs";
import { renderedLayoutSprig } from "./layout/sprigs";

/* Equality */

const equalCursorPoints = equalNullable(equalSelectionPoints);

const equalPresenceItem = (previous: EditorPresence, next: EditorPresence) => {
  return (
    previous.id === next.id &&
    previous.username === next.username &&
    previous.fullName === next.fullName &&
    previous.avatarUrl === next.avatarUrl &&
    previous.color === next.color &&
    previous.status === next.status &&
    previous.commentThreadIndex === next.commentThreadIndex &&
    previous.isOnUnresolvedCommentThread === next.isOnUnresolvedCommentThread &&
    equalCursorPoints(previous.cursorPoint, next.cursorPoint) &&
    equalShallowObject(previous.viewport, next.viewport)
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
  [documentIndexSprig, renderedLayoutSprig],
  (
    store,
    [userPresence]: readonly [DocumentUserPresence[] | undefined],
    documentIndex,
    layout,
  ): EditorPresence[] | undefined => {
    const targets = presenceTargetsSprig.read(store, userPresence);

    if (!targets) {
      return undefined;
    }

    if (!layout) {
      return targets;
    }

    const commentRanges = targets.some((presenceItem) => {
      return presenceItem.commentThreadIndex != null;
    })
      ? commentStateSprig.read(store).ranges
      : [];

    return resolvePresenceViewport(documentIndex, layout, targets, commentRanges);
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
