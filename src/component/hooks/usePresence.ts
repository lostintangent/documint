// Owns host-side presence orchestration. The editor resolves semantic cursor
// anchors and viewport geometry; this hook keeps those projections fresh for
// canvas paint and for the DOM indicators that can scroll to off-screen cursors.
import {
  resolvePresenceCursors,
  resolvePresenceViewport,
  type EditorPresence,
  type EditorState,
  type EditorViewportState,
} from "@/editor";
import type { Presence } from "@/types";
import type { LazyRefHandle } from "./useLazyRef";
import {
  type RefObject,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

const emptyEditorPresence: EditorPresence[] = [];

type UsePresenceOptions = {
  editorState: EditorState;
  editorStateRef: RefObject<EditorState | null>;
  editorViewportState: LazyRefHandle<EditorViewportState>;
  onViewportScroll: (scrollContainer: HTMLDivElement) => void;
  presence?: Presence[];
  scrollContainerRef: RefObject<HTMLDivElement | null>;
  scheduleOverlayRender: () => void;
};

export type PresenceController = {
  // Canvas overlay input for remote/user/agent cursors.
  canvasPresence: EditorPresence[] | undefined;
  presenceOverlayProps: {
    onSelect: (presence: EditorPresence) => void;
    presence: EditorPresence[];
  };
  refreshViewportPresence: (viewportState: EditorViewportState) => void;
};

export function usePresence({
  editorState,
  editorStateRef,
  editorViewportState,
  onViewportScroll,
  presence,
  scrollContainerRef,
  scheduleOverlayRender,
}: UsePresenceOptions): PresenceController {
  const resolvedPresence = useMemo<EditorPresence[]>(() => {
    if (!presence || presence.length === 0) {
      return emptyEditorPresence;
    }

    return resolvePresenceCursors(editorState.documentIndex, presence);
  }, [editorState.documentIndex, presence]);
  const [viewportIndicatorPresence, setViewportIndicatorPresence] = useState<EditorPresence[]>([]);
  const resolvedPresenceRef = useRef<EditorPresence[]>(resolvedPresence);
  const viewportIndicatorPresenceRef = useRef<EditorPresence[]>(viewportIndicatorPresence);

  resolvedPresenceRef.current = resolvedPresence;
  viewportIndicatorPresenceRef.current = viewportIndicatorPresence;

  const updateViewportIndicators = useEffectEvent((nextPresence: EditorPresence[]) => {
    if (arePresenceViewportsEqual(viewportIndicatorPresenceRef.current, nextPresence)) {
      return;
    }

    viewportIndicatorPresenceRef.current = nextPresence;
    setViewportIndicatorPresence(nextPresence);
  });

  const refreshViewportPresence = useEffectEvent((viewportState: EditorViewportState) => {
    const currentPresence = resolvedPresenceRef.current;

    if (currentPresence.length === 0) {
      updateViewportIndicators([]);
      return;
    }

    updateViewportIndicators(
      resolvePresenceViewport(
        editorStateRef.current ?? editorState,
        viewportState,
        currentPresence,
      ),
    );
  });

  useEffect(() => {
    scheduleOverlayRender();
  }, [resolvedPresence, scheduleOverlayRender]);

  useLayoutEffect(() => {
    if (resolvedPresence.length === 0) {
      updateViewportIndicators([]);
      return;
    }

    refreshViewportPresence(editorViewportState.get());
  }, [editorViewportState, refreshViewportPresence, resolvedPresence, updateViewportIndicators]);

  const scrollToPresence = useEffectEvent((presenceItem: EditorPresence) => {
    if (!presenceItem.viewport || presenceItem.viewport.scrollTop === null) {
      return;
    }

    const scrollContainer = scrollContainerRef.current;

    if (!scrollContainer) {
      return;
    }

    scrollContainer.scrollTop = presenceItem.viewport.scrollTop;
    onViewportScroll(scrollContainer);
  });

  return {
    canvasPresence: resolvedPresence.length === 0 ? undefined : resolvedPresence,
    presenceOverlayProps: {
      onSelect: scrollToPresence,
      presence: viewportIndicatorPresence,
    },
    refreshViewportPresence,
  };
}

function arePresenceViewportsEqual(previous: EditorPresence[], next: EditorPresence[]) {
  if (previous.length !== next.length) {
    return false;
  }

  return previous.every((presence, index) => {
    const nextPresence = next[index];

    return (
      nextPresence !== undefined &&
      presence.color === nextPresence.color &&
      presence.imageUrl === nextPresence.imageUrl &&
      presence.name === nextPresence.name &&
      presence.viewport?.scrollTop === nextPresence.viewport?.scrollTop &&
      presence.viewport?.status === nextPresence.viewport?.status
    );
  });
}
