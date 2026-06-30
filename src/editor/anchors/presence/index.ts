/**
 * Editor-side resolution of host-provided presence targets.
 *
 * Presence is ephemeral collaboration state provided by the host as a
 * content-addressable anchor. Text anchors resolve to remote cursor points;
 * comment-thread anchors resolve to active thread indices so the comment rule
 * can carry the user's presence color. Viewport mapping lives in
 * `viewport.ts`.
 */

import {
  collectTextAnchorCandidates,
  isCommentThreadAnchor,
  isResolvedCommentThread,
  type Anchor,
  type AnchorContainer,
  type TextAnchor,
} from "@/document";
import type { DocumentUserPresence } from "@/types";
import type { DocumentIndex, EditorSelectionPoint } from "../../state";
import { createEditorTextAnchorResolver, type EditorTextAnchorResolver } from "../text";

// --- Types ---

// Where a presence sits relative to the prepared viewport. `scrollTop` is the
// y-position the host would scroll to to bring this target into view; it only
// exists when the target was geometrically resolvable, so `unresolved` lacks
// it by construction.
export type EditorPresenceViewport =
  | { status: "unresolved" }
  | { status: "above" | "below" | "visible"; scrollTop: number };

export type EditorPresenceViewportStatus = EditorPresenceViewport["status"];

export type EditorPresence = DocumentUserPresence & {
  commentThreadIndex: number | null;
  cursorPoint: EditorSelectionPoint | null;
  isOnUnresolvedCommentThread: boolean;
  viewport: EditorPresenceViewport | null;
};

type TextPresenceContext = {
  anchorContainers: AnchorContainer[];
  textAnchorResolver: EditorTextAnchorResolver;
};

// --- Public API ---

// Resolve each host-provided presence into editor-side targets. Text anchors
// produce cursor points; comment-thread anchors produce active thread indices
// without resolving a cursor.
export function resolvePresenceTargets(
  documentIndex: DocumentIndex,
  presence: DocumentUserPresence[],
): EditorPresence[] {
  if (presence.length === 0) {
    return [];
  }

  let textContext: TextPresenceContext | null = null;
  const getTextContext = () => {
    if (!textContext) {
      const textAnchorResolver = createEditorTextAnchorResolver(documentIndex);
      textContext = {
        anchorContainers: textAnchorResolver.listContainers(),
        textAnchorResolver,
      };
    }

    return textContext;
  };

  return presence.map((presenceItem) => ({
    ...presenceItem,
    ...resolvePresenceTarget(presenceItem, getTextContext, documentIndex),
    viewport: null,
  }));
}

// --- Internal helpers ---

function resolvePresenceTarget(
  presence: DocumentUserPresence,
  getTextContext: () => TextPresenceContext,
  documentIndex: DocumentIndex,
) {
  if (!presence.cursor) {
    return {
      commentThreadIndex: null,
      cursorPoint: null,
      isOnUnresolvedCommentThread: false,
    };
  }

  if (isCommentThreadAnchor(presence.cursor)) {
    return resolveCommentThreadPresenceTarget(presence.cursor, documentIndex);
  }

  const { anchorContainers, textAnchorResolver } = getTextContext();

  return {
    commentThreadIndex: null,
    cursorPoint: resolvePresenceCursorPoint(
      presence.cursor,
      anchorContainers,
      textAnchorResolver,
    ),
    isOnUnresolvedCommentThread: false,
  };
}

function resolveCommentThreadPresenceTarget(
  anchor: Extract<Anchor, { threadId: string }>,
  documentIndex: DocumentIndex,
) {
  const threadIndex = documentIndex.document.comments.findIndex(
    (thread) => thread.id === anchor.threadId,
  );

  const thread = threadIndex >= 0 ? documentIndex.document.comments[threadIndex] : undefined;

  return {
    commentThreadIndex: thread ? threadIndex : null,
    cursorPoint: null,
    isOnUnresolvedCommentThread: thread ? !isResolvedCommentThread(thread) : false,
  };
}

function resolvePresenceCursorPoint(
  anchor: TextAnchor,
  anchorContainers: AnchorContainer[],
  textAnchorResolver: EditorTextAnchorResolver,
) {
  const matches = collectTextAnchorCandidates(anchorContainers, anchor);

  if (matches.length !== 1) {
    return null;
  }

  const match = matches[0]!;
  const editorRange = textAnchorResolver.resolveEditorRange(
    {
      containerOrdinal: match.container.containerOrdinal,
      containerPath: match.container.path,
      endOffset: match.startOffset,
      startOffset: match.startOffset,
    },
    {
      collapsedAffinity: resolvePresenceCursorAffinity(anchor),
    },
  );

  if (!editorRange) {
    return null;
  }

  return {
    offset: editorRange.startOffset,
    path: editorRange.path,
  };
}

function resolvePresenceCursorAffinity(anchor: TextAnchor) {
  return anchor.prefix ? "after" : "before";
}
