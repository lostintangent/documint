import {
  normalizeSelection,
  resolveEditorSearchMatches,
  setSelection,
  type DocumentIndex,
  type EditorSearchMatch,
  type EditorState,
  type NormalizedEditorSelection,
} from "@/editor";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
} from "react";
import type { SearchLeaf } from "../overlays/leaves/core/shared";
import {
  normalizedSelectionSprig,
  useDocumintStore,
  useEditorCommand,
  type DocumintStore,
} from "../store";

type SearchController = {
  handleKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => boolean;
  leaf: SearchLeaf | null;
};

// Stable enough to keep the active match through edits when it still exists.
type ActiveMatchKey = { regionId: string; startOffset: number };

type SearchState = {
  activeMatchKey: ActiveMatchKey | null;
  // Fallback when the active match was edited away.
  activeMatchIndex: number;
  caseSensitive: boolean;
  isOpen: boolean;
  query: string;
};

const emptyMatches: readonly EditorSearchMatch[] = [];
const initialSearchState: SearchState = {
  activeMatchKey: null,
  activeMatchIndex: 0,
  caseSensitive: false,
  isOpen: false,
  query: "",
};

export function useSearch(): SearchController {
  const store = useDocumintStore();
  const [search, setSearch] = useState<SearchState>(initialSearchState);
  // Pinned eagerly on open so the first search render resolves against the
  // current document; refreshed only by document changes while search is open.
  const [openDocumentIndex, setOpenDocumentIndex] = useState<DocumentIndex | null>(null);
  const isApplyingSearchSelectionRef = useRef(false);

  const selectMatch = useEditorCommand(selectSearchMatch);
  const collapseSelectionToStart = useEditorCommand(collapseSelection);

  useEffect(() => {
    if (!search.isOpen) {
      setOpenDocumentIndex(null);
      return;
    }

    return store.editor.subscribe((transition) => {
      if (transition.documentChanged) {
        setOpenDocumentIndex(transition.next.documentIndex);
      }

      if (
        transition.source === "local" &&
        transition.previous.selection !== transition.next.selection &&
        !isApplyingSearchSelectionRef.current
      ) {
        setSearch(initialSearchState);
      }
    });
  }, [search.isOpen, store]);

  const matches = useMemo<readonly EditorSearchMatch[]>(() => {
    if (!search.isOpen || !openDocumentIndex || search.query.length === 0) {
      return emptyMatches;
    }

    return resolveEditorSearchMatches(openDocumentIndex, search.query, {
      caseSensitive: search.caseSensitive,
    });
  }, [openDocumentIndex, search.caseSensitive, search.isOpen, search.query]);

  // Prefer identity; fall back to the last index when edits remove a match.
  const activeIndex = useMemo(() => {
    if (matches.length === 0) {
      return 0;
    }

    if (search.activeMatchKey) {
      const found = matches.findIndex(
        (match) =>
          match.regionId === search.activeMatchKey!.regionId &&
          match.startOffset === search.activeMatchKey!.startOffset,
      );

      if (found !== -1) {
        return found;
      }
    }

    return Math.min(search.activeMatchIndex, matches.length - 1);
  }, [matches, search.activeMatchKey, search.activeMatchIndex]);

  const activeMatch = matches[activeIndex] ?? null;

  const collapseSearchSelection = useEffectEvent(() => {
    try {
      isApplyingSearchSelectionRef.current = true;
      collapseSelectionToStart();
    } finally {
      isApplyingSearchSelectionRef.current = false;
    }
  });

  // Selection is the active-match highlight; `useCursor` owns the resulting
  // scroll, including virtualized off-layout targets.
  useEffect(() => {
    if (!search.isOpen || !activeMatch) {
      return;
    }

    try {
      isApplyingSearchSelectionRef.current = true;
      selectMatch(activeMatch);
    } finally {
      isApplyingSearchSelectionRef.current = false;
    }
  }, [
    activeMatch?.endOffset,
    activeMatch?.regionId,
    activeMatch?.startOffset,
    search.isOpen,
    selectMatch,
  ]);

  useEffect(() => {
    if (!search.isOpen || activeMatch) {
      return;
    }

    collapseSearchSelection();
  }, [
    activeMatch?.endOffset,
    activeMatch?.regionId,
    activeMatch?.startOffset,
    collapseSearchSelection,
    search.isOpen,
  ]);

  const close = useEffectEvent(() => {
    collapseSearchSelection();
    setSearch(initialSearchState);
  });

  const dismiss = useEffectEvent(() => {
    if (search.query.length === 0) {
      close();
      return;
    }

    collapseSearchSelection();
    setSearch((current) => ({
      ...current,
      activeMatchKey: null,
      activeMatchIndex: 0,
      query: "",
    }));
  });

  const moveActiveMatch = useEffectEvent((direction: -1 | 1) => {
    if (matches.length === 0) {
      return;
    }

    const nextIndex = (activeIndex + direction + matches.length) % matches.length;
    const nextMatch = matches[nextIndex]!;

    setSearch((current) => ({
      ...current,
      activeMatchKey: { regionId: nextMatch.regionId, startOffset: nextMatch.startOffset },
      activeMatchIndex: nextIndex,
    }));
  });

  const updateQuery = useEffectEvent((query: string) => {
    setSearch((current) => ({
      ...current,
      activeMatchKey: null,
      activeMatchIndex: 0,
      query,
    }));
  });

  const toggleCaseSensitive = useEffectEvent(() => {
    setSearch((current) => ({
      ...current,
      caseSensitive: !current.caseSensitive,
    }));
  });

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (isModFindEvent(event)) {
      event.preventDefault();
      event.stopPropagation();
      const editorState = store.editor.getState();
      const initial = resolveInitialSearch(
        store,
        editorState.documentIndex,
        search.query,
        search.caseSensitive,
      );
      setOpenDocumentIndex(editorState.documentIndex);
      setSearch((current) => ({
        ...current,
        activeMatchKey: initial.activeMatchKey,
        activeMatchIndex: initial.activeMatchIndex,
        isOpen: true,
        query: initial.query,
      }));
      return true;
    }

    if (!search.isOpen) {
      return false;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      dismiss();
      return true;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      moveActiveMatch(event.shiftKey ? -1 : 1);
      return true;
    }

    return false;
  };

  return {
    handleKeyDown,
    leaf: search.isOpen
      ? {
          activeMatchNumber: matches.length > 0 ? activeIndex + 1 : 0,
          canNavigate: matches.length > 0,
          caseSensitive: search.caseSensitive,
          kind: "search",
          matchCount: matches.length,
          onChange: updateQuery,
          onClose: close,
          onDismiss: dismiss,
          onNext: () => moveActiveMatch(1),
          onPrevious: () => moveActiveMatch(-1),
          onToggleCaseSensitive: toggleCaseSensitive,
          query: search.query,
        }
      : null,
  };
}

function selectSearchMatch(state: EditorState, match: EditorSearchMatch): EditorState | null {
  const normalized = normalizeSelection(state);
  if (
    normalized.start.regionId === match.regionId &&
    normalized.start.offset === match.startOffset &&
    normalized.end.regionId === match.regionId &&
    normalized.end.offset === match.endOffset
  ) {
    return null;
  }

  return setSelection(state, {
    anchor: { offset: match.startOffset, regionId: match.regionId },
    focus: { offset: match.endOffset, regionId: match.regionId },
  });
}

function collapseSelection(state: EditorState): EditorState {
  const normalized = normalizeSelection(state);
  if (normalized.collapsed) {
    return state;
  }
  return setSelection(state, { anchor: normalized.start, focus: normalized.start });
}

function resolveInitialSearch(
  store: DocumintStore,
  documentIndex: DocumentIndex,
  fallbackQuery: string,
  caseSensitive: boolean,
): { activeMatchIndex: number; activeMatchKey: ActiveMatchKey | null; query: string } {
  const selection = normalizedSelectionSprig.read(store);
  const query = resolveQueryFromSelection(store, selection) ?? fallbackQuery;

  if (query.length === 0) {
    return { activeMatchIndex: 0, activeMatchKey: null, query };
  }

  const matches = resolveEditorSearchMatches(documentIndex, query, { caseSensitive });
  const matchedIndex = resolveMatchIndexFromSelection(selection, matches);

  if (matchedIndex === null) {
    return { activeMatchIndex: 0, activeMatchKey: null, query };
  }

  const matched = matches[matchedIndex]!;
  return {
    activeMatchIndex: matchedIndex,
    activeMatchKey: { regionId: matched.regionId, startOffset: matched.startOffset },
    query,
  };
}

function resolveQueryFromSelection(
  store: DocumintStore,
  selection: NormalizedEditorSelection,
): string | null {
  if (selection.collapsed || selection.start.regionId !== selection.end.regionId) {
    return null;
  }

  const region = store.editor.getState().documentIndex.regionIndex.get(selection.start.regionId);
  const query = region?.text.slice(selection.start.offset, selection.end.offset) ?? "";

  return query.length > 0 ? query : null;
}

function resolveMatchIndexFromSelection(
  selection: NormalizedEditorSelection,
  matches: readonly EditorSearchMatch[],
): number | null {
  if (selection.collapsed || selection.start.regionId !== selection.end.regionId) {
    return null;
  }

  const index = matches.findIndex(
    (match) =>
      match.regionId === selection.start.regionId &&
      match.startOffset === selection.start.offset &&
      match.endOffset === selection.end.offset,
  );

  return index === -1 ? null : index;
}

function isModFindEvent(
  event: Pick<ReactKeyboardEvent<HTMLElement>, "ctrlKey" | "key" | "metaKey">,
) {
  return (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f";
}
