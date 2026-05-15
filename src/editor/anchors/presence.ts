/**
 * Editor-side resolution of host-provided presence targets.
 *
 * Presence is ephemeral collaboration state provided by the host as a
 * content-addressable anchor. Text anchors resolve to remote cursor points;
 * comment-thread anchors resolve to active thread indices so the comment rule
 * can carry the user's presence color. Geometric measurement is left to
 * layout/paint.
 */

import {
  findContextRanges,
  findOccurrences,
  isCommentThreadAnchor,
  type Anchor,
  type AnchorContainer,
  type TextAnchor,
} from "@/document";
import type { DocumentUserPresence } from "@/types";
import type { DocumentIndex, EditorSelectionPoint } from "../state";
import { projectAnchorContainersToEditor } from "./index";

// --- Types ---

// Where a presence sits relative to the prepared viewport. `scrollTop` is the
// y-position the host would scroll to to bring this cursor into view; it only
// exists when the cursor was geometrically resolvable, so `unresolved` lacks
// it by construction.
export type EditorPresenceViewport =
  | { status: "unresolved" }
  | { status: "above" | "below" | "visible"; scrollTop: number };

export type EditorPresenceViewportStatus = EditorPresenceViewport["status"];

export type EditorPresence = DocumentUserPresence & {
  commentThreadIndex: number | null;
  cursorPoint: EditorSelectionPoint | null;
  viewport: EditorPresenceViewport | null;
};

type PresenceMatch = {
  container: AnchorContainer;
  offset: number;
};

// --- Public API ---

// Resolve each host-provided presence into editor-side targets. Text anchors
// produce cursor points; comment-thread anchors produce active thread indices
// without projecting a cursor.
export function resolvePresenceTargets(
  documentIndex: DocumentIndex,
  presence: DocumentUserPresence[],
): EditorPresence[] {
  if (presence.length === 0) {
    return [];
  }

  const containerProjection = projectAnchorContainersToEditor(documentIndex);
  const semanticContainers = containerProjection.list();

  return presence.map((presenceItem) => ({
    ...presenceItem,
    ...resolvePresenceTarget(presenceItem, semanticContainers, containerProjection, documentIndex),
    viewport: null,
  }));
}

// --- Internal helpers ---

function resolvePresenceTarget(
  presence: DocumentUserPresence,
  semanticContainers: AnchorContainer[],
  containerProjection: ReturnType<typeof projectAnchorContainersToEditor>,
  documentIndex: DocumentIndex,
) {
  if (!presence.cursor) {
    return {
      commentThreadIndex: null,
      cursorPoint: null,
    };
  }

  if (isCommentThreadAnchor(presence.cursor)) {
    return resolveCommentThreadPresenceTarget(presence.cursor, documentIndex);
  }

  return {
    commentThreadIndex: null,
    cursorPoint: resolvePresenceCursorPoint(
      presence.cursor,
      semanticContainers,
      containerProjection,
    ),
  };
}

function resolveCommentThreadPresenceTarget(
  anchor: Extract<Anchor, { threadId: string }>,
  documentIndex: DocumentIndex,
) {
  const threadIndex = documentIndex.document.comments.findIndex(
    (thread) => thread.id === anchor.threadId,
  );

  return {
    commentThreadIndex: threadIndex >= 0 ? threadIndex : null,
    cursorPoint: null,
  };
}

function resolvePresenceCursorPoint(
  anchor: TextAnchor,
  semanticContainers: AnchorContainer[],
  containerProjection: ReturnType<typeof projectAnchorContainersToEditor>,
) {
  const candidateContainers = filterAnchorContainers(semanticContainers, anchor);
  const matches = collectAnchorMatches(candidateContainers, anchor);

  if (matches.length !== 1) {
    return null;
  }

  const match = matches[0]!;
  const runtimeContainer = containerProjection.resolveRuntimeContainer(match.container.id);

  if (!runtimeContainer) {
    return null;
  }

  return {
    offset: Math.max(0, Math.min(match.offset, runtimeContainer.text.length)),
    regionId: runtimeContainer.id,
  };
}

function filterAnchorContainers(containers: AnchorContainer[], anchor: TextAnchor) {
  return anchor.kind
    ? containers.filter((container) => container.containerKind === anchor.kind)
    : containers;
}

// Dispatch on which side of the anchor descriptor is present. Presence does
// not score; it requires an unambiguous match, so each branch returns raw
// candidates and the caller filters by `length === 1`.
function collectAnchorMatches(containers: AnchorContainer[], anchor: TextAnchor) {
  if (anchor.prefix && anchor.suffix) {
    return collectBetweenTextMatches(containers, anchor.prefix, anchor.suffix);
  }

  if (anchor.prefix) {
    return collectSingleTextMatches(containers, anchor.prefix, "after");
  }

  if (anchor.suffix) {
    return collectSingleTextMatches(containers, anchor.suffix, "before");
  }

  return [];
}

function collectSingleTextMatches(
  containers: AnchorContainer[],
  text: string,
  side: "after" | "before",
) {
  const matches: PresenceMatch[] = [];

  for (const container of containers) {
    for (const startOffset of findOccurrences(container.text, text)) {
      matches.push({
        container,
        offset: side === "after" ? startOffset + text.length : startOffset,
      });
    }
  }

  return matches;
}

function collectBetweenTextMatches(containers: AnchorContainer[], prefix: string, suffix: string) {
  const matches: PresenceMatch[] = [];

  for (const container of containers) {
    for (const range of findContextRanges(container.text, prefix, suffix)) {
      matches.push({ container, offset: range.startOffset });
    }
  }

  return matches;
}
