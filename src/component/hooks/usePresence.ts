// Owns host-side presence orchestration. The editor resolves semantic cursor
// anchors and viewport geometry; this hook keeps the resolved presence list
// fresh for both the canvas (which paints remote carets) and the DOM overlay
// (which renders scroll-to-cursor arrow buttons for off-screen presences).
//
// Two stages internally:
//   1. Resolve each user's anchor against the document → cursor positions.
//      Stable across scrolls; only re-runs when the user list or doc changes.
//   2. Project those cursors against the prepared viewport → above/below/visible
//      status + scroll target. Re-runs on every viewport render (incl. scrolls).
//
// Only stage 2's output (`presence`) is exposed. The canvas reads the same list
// and ignores the `viewport` field; the DOM overlay reads both.
import {
  resolvePresenceCursors,
  resolvePresenceViewport,
  type EditorPresence,
  type EditorPresenceViewport,
  type EditorState,
  type EditorLayoutState,
} from "@/editor";
import type { DocumentUserPresence } from "@/types";
import type { LazyRefHandle } from "./useLazyRef";
import {
  type RefObject,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useState,
} from "react";

type UsePresenceOptions = {
  editorState: EditorState;
  editorStateRef: RefObject<EditorState | null>;
  editorViewportState: LazyRefHandle<EditorLayoutState>;
  onViewportScroll: (scrollContainer: HTMLDivElement) => void;
  scrollContainerRef: RefObject<HTMLDivElement | null>;
  scheduleOverlayRender: () => void;
  userPresence?: DocumentUserPresence[];
};

export type PresenceController = {
  presence: EditorPresence[] | undefined;
  scrollToPresence: (presence: EditorPresence) => void;
  refreshPresence: (viewportState: EditorLayoutState) => void;
};

export function usePresence({
  editorState,
  editorStateRef,
  editorViewportState,
  onViewportScroll,
  scrollContainerRef,
  scheduleOverlayRender,
  userPresence,
}: UsePresenceOptions): PresenceController {
  // Stage 1 (private): cursor positions resolved against the document.
  const cursors = useMemo<EditorPresence[] | undefined>(() => {
    if (!userPresence || userPresence.length === 0) {
      return undefined;
    }
    return resolvePresenceCursors(editorState.documentIndex, userPresence);
  }, [editorState.documentIndex, userPresence]);

  // Stage 2: cursors projected against the current viewport.
  const [presence, setPresence] = useState<EditorPresence[] | undefined>(undefined);

  // Cursors-changed path: derive presence unconditionally and schedule a paint.
  // Equality-based bailout is unsafe here — cursor identity changes can carry
  // material updates (color, anchor) that don't surface in viewport status.
  const resyncPresence = useEffectEvent(() => {
    if (cursors === undefined) {
      if (presence !== undefined) {
        setPresence(undefined);
      }
    } else {
      setPresence(
        resolvePresenceViewport(
          editorStateRef.current ?? editorState,
          editorViewportState.get(),
          cursors,
        ),
      );
    }

    // Canvas paints are imperative; React re-renders don't schedule them.
    // Without this, host-driven prop changes wouldn't reach the overlay until
    // the next viewport render (scroll, edit, etc.) happened to trigger one.
    scheduleOverlayRender();
  });

  // Per-frame path: called by the render scheduler on every viewport render.
  // Bails out when scroll didn't flip any presence's viewport status, so
  // steady-state scrolling doesn't trigger a Documint re-render.
  const refreshPresence = useEffectEvent((viewportState: EditorLayoutState) => {
    if (cursors === undefined) {
      if (presence !== undefined) {
        setPresence(undefined);
      }
      return;
    }

    const next = resolvePresenceViewport(
      editorStateRef.current ?? editorState,
      viewportState,
      cursors,
    );

    if (arePresenceListsEqual(presence, next)) {
      return;
    }

    setPresence(next);
  });

  useLayoutEffect(() => {
    resyncPresence();
  }, [cursors]);

  const scrollToPresence = useEffectEvent((target: EditorPresence) => {
    if (!target.viewport || target.viewport.status === "unresolved") {
      return;
    }

    const scrollContainer = scrollContainerRef.current;

    if (!scrollContainer) {
      return;
    }

    scrollContainer.scrollTop = target.viewport.scrollTop;
    onViewportScroll(scrollContainer);
  });

  return {
    presence,
    scrollToPresence,
    refreshPresence,
  };
}

// Per-frame bailout for the scheduler path. Identity + viewport state are the
// only fields that can change between two scroll frames over the same cursor
// list, so they're the only fields we compare here.
function arePresenceListsEqual(
  previous: EditorPresence[] | undefined,
  next: EditorPresence[] | undefined,
) {
  if (previous === next) {
    return true;
  }

  if (previous === undefined || next === undefined || previous.length !== next.length) {
    return false;
  }

  return previous.every((entry, index) => {
    const nextEntry = next[index]!;
    return entry.id === nextEntry.id && areViewportsEqual(entry.viewport, nextEntry.viewport);
  });
}

function areViewportsEqual(
  previous: EditorPresenceViewport | null,
  next: EditorPresenceViewport | null,
) {
  if (previous === next) return true;
  if (previous === null || next === null) return false;
  if (previous.status === "unresolved") return next.status === "unresolved";
  if (next.status === "unresolved") return false;
  return previous.status === next.status && previous.scrollTop === next.scrollTop;
}
