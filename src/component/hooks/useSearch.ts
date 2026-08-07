import {
  normalizeSelection,
  resolveEditorTextAtPath,
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
type ActiveMatchKey = { path: string; startOffset: number };

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
  /* Search state */

  const store = useDocumintStore();
  const [searchState, setSearchState] = useState<SearchState>(initialSearchState);
  // Pinned eagerly on open so the first search render resolves against the
  // current document; refreshed only by document changes while search is open.
  const [openDocumentIndex, setOpenDocumentIndex] = useState<DocumentIndex | null>(null);
  const isApplyingSearchSelectionRef = useRef(false);

  /* Editor commands */

  const selectMatch = useEditorCommand(selectSearchMatch);
  const collapseSelectionToStart = useEditorCommand(collapseSelection);

  /* Document tracking */

  useEffect(() => {
    if (!searchState.isOpen) {
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
        setSearchState(initialSearchState);
      }
    });
  }, [searchState.isOpen, store]);

  /* Match resolution */

  const matches = useMemo<readonly EditorSearchMatch[]>(() => {
    if (!searchState.isOpen || !openDocumentIndex || searchState.query.length === 0) {
      return emptyMatches;
    }

    return resolveEditorSearchMatches(openDocumentIndex, searchState.query, {
      caseSensitive: searchState.caseSensitive,
    });
  }, [openDocumentIndex, searchState.caseSensitive, searchState.isOpen, searchState.query]);

  // Prefer identity; fall back to the last index when edits remove a match.
  const activeIndex = useMemo(() => {
    if (matches.length === 0) {
      return 0;
    }

    if (searchState.activeMatchKey) {
      const activeMatchKey = searchState.activeMatchKey;
      const found = matches.findIndex(
        (match) =>
          match.path === activeMatchKey.path && match.startOffset === activeMatchKey.startOffset,
      );

      if (found !== -1) {
        return found;
      }
    }

    return Math.min(searchState.activeMatchIndex, matches.length - 1);
  }, [matches, searchState.activeMatchKey, searchState.activeMatchIndex]);

  const activeMatch = matches[activeIndex] ?? null;

  /* Selection synchronization */

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
    if (!searchState.isOpen || !activeMatch) {
      return;
    }

    try {
      isApplyingSearchSelectionRef.current = true;
      selectMatch(activeMatch);
    } finally {
      isApplyingSearchSelectionRef.current = false;
    }
  }, [activeMatch, searchState.isOpen, selectMatch]);

  useEffect(() => {
    if (!searchState.isOpen || activeMatch) {
      return;
    }

    collapseSearchSelection();
  }, [activeMatch, searchState.isOpen]);

  /* Search actions */

  const close = useEffectEvent(() => {
    collapseSearchSelection();
    setSearchState(initialSearchState);
  });

  const dismiss = useEffectEvent(() => {
    if (searchState.query.length === 0) {
      close();
      return;
    }

    collapseSearchSelection();
    setSearchState((current) => ({
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

    setSearchState((current) => ({
      ...current,
      activeMatchKey: { path: nextMatch.path, startOffset: nextMatch.startOffset },
      activeMatchIndex: nextIndex,
    }));
  });

  const updateQuery = useEffectEvent((query: string) => {
    setSearchState((current) => ({
      ...current,
      activeMatchKey: null,
      activeMatchIndex: 0,
      query,
    }));
  });

  const toggleCaseSensitive = useEffectEvent(() => {
    setSearchState((current) => ({
      ...current,
      caseSensitive: !current.caseSensitive,
    }));
  });

  /* Keyboard handling */

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (isModFindEvent(event)) {
      event.preventDefault();
      event.stopPropagation();
      const editorState = store.editor.getState();
      const initial = resolveInitialSearch(
        store,
        editorState.documentIndex,
        searchState.query,
        searchState.caseSensitive,
      );
      setOpenDocumentIndex(editorState.documentIndex);
      setSearchState((current) => ({
        ...current,
        activeMatchKey: initial.activeMatchKey,
        activeMatchIndex: initial.activeMatchIndex,
        isOpen: true,
        query: initial.query,
      }));
      return true;
    }

    if (!searchState.isOpen) {
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

  /* Public API */

  return {
    handleKeyDown,
    leaf: searchState.isOpen
      ? {
          activeMatchNumber: matches.length > 0 ? activeIndex + 1 : 0,
          canNavigate: matches.length > 0,
          caseSensitive: searchState.caseSensitive,
          kind: "search",
          matchCount: matches.length,
          onChange: updateQuery,
          onClose: close,
          onDismiss: dismiss,
          onNext: () => moveActiveMatch(1),
          onPrevious: () => moveActiveMatch(-1),
          onToggleCaseSensitive: toggleCaseSensitive,
          query: searchState.query,
        }
      : null,
  };
}

function selectSearchMatch(state: EditorState, match: EditorSearchMatch): EditorState | null {
  const normalized = normalizeSelection(state);
  if (
    normalized.start.path === match.path &&
    normalized.start.offset === match.startOffset &&
    normalized.end.path === match.path &&
    normalized.end.offset === match.endOffset
  ) {
    return null;
  }

  return setSelection(state, {
    anchor: { offset: match.startOffset, path: match.path },
    focus: { offset: match.endOffset, path: match.path },
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
    activeMatchKey: { path: matched.path, startOffset: matched.startOffset },
    query,
  };
}

function resolveQueryFromSelection(
  store: DocumintStore,
  selection: NormalizedEditorSelection,
): string | null {
  if (selection.collapsed || selection.start.path !== selection.end.path) {
    return null;
  }

  const text = resolveEditorTextAtPath(store.editor.getState().documentIndex, selection.start.path);
  const query = text?.slice(selection.start.offset, selection.end.offset) ?? "";

  return query.length > 0 ? query : null;
}

function resolveMatchIndexFromSelection(
  selection: NormalizedEditorSelection,
  matches: readonly EditorSearchMatch[],
): number | null {
  if (selection.collapsed || selection.start.path !== selection.end.path) {
    return null;
  }

  const index = matches.findIndex(
    (match) =>
      match.path === selection.start.path &&
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
