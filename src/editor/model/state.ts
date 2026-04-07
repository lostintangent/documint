import {
  buildDocument,
  rebuildTableBlock,
  rebuildTextBlock,
  spliceCommentThreads,
  type Block,
  type Document,
  type Inline,
  type TableRow,
} from "@/document";
import type { CommentThread } from "@/comments";
import { getCommentState } from "../comments";
import { getEditorAnimationDuration } from "../render/animations";
import {
  createDocumentEditor,
  resolveSelectionTarget,
  type DocumentEditor,
  type CanvasSelection,
  type CanvasSelectionPoint,
  type EditorSelectionTarget,
} from "./document-editor";

export type EditorState = {
  // Transient paint animations belong to editor runtime state, not persisted document state.
  animations: EditorAnimation[];
  documentEditor: DocumentEditor;
  future: Document[];
  history: Document[];
  selection: CanvasSelection;
};

export type EditorAnimation =
  | ActiveBlockFlashAnimation
  | DeletedTextFadeAnimation
  | InsertedTextHighlightAnimation
  | PunctuationPulseAnimation;

export type ActiveBlockFlashAnimation = {
  blockPath: string;
  kind: "active-block-flash";
  startedAt: number;
};

export type DeletedTextFadeAnimation = {
  kind: "deleted-text-fade";
  regionPath: string;
  startOffset: number;
  startedAt: number;
  text: string;
};

export type InsertedTextHighlightAnimation = {
  endOffset: number;
  kind: "inserted-text-highlight";
  regionPath: string;
  startOffset: number;
  startedAt: number;
};

export type PunctuationPulseAnimation = {
  kind: "punctuation-pulse";
  offset: number;
  regionPath: string;
  startedAt: number;
};

export function createEditorState(document: Document): EditorState {
  const documentEditor = createDocumentEditor(document);
  const initialPoint = resolveDefaultSelectionPoint(documentEditor);

  return {
    animations: [],
    future: [],
    history: [],
    documentEditor,
    selection: {
      anchor: initialPoint,
      focus: initialPoint,
    },
  };
}

export function createDocumentFromEditorState(state: EditorState) {
  const commentState = getCommentState(state.documentEditor);

  return buildDocument({
    blocks: trimDocumentTrailingProseWhitespace(state.documentEditor.document.blocks),
    comments: commentState.threads,
  });
}

export function setCanvasSelection(
  state: EditorState,
  selection: CanvasSelection | CanvasSelectionPoint,
): EditorState {
  const nextSelection: CanvasSelection =
    "regionId" in selection
      ? {
          anchor: clampSelectionPoint(state.documentEditor, selection),
          focus: clampSelectionPoint(state.documentEditor, selection),
        }
      : {
          anchor: clampSelectionPoint(state.documentEditor, selection.anchor),
          focus: clampSelectionPoint(state.documentEditor, selection.focus),
        };

  return {
    ...state,
    selection: nextSelection,
  };
}

export function addInsertedTextHighlightAnimation(
  state: EditorState,
  insertedTextLength: number,
  startedAt = getEditorAnimationTime(),
): EditorState {
  if (insertedTextLength <= 0) {
    return state;
  }

  const region = state.documentEditor.regionIndex.get(state.selection.focus.regionId);

  if (!region) {
    return state;
  }

  const endOffset = state.selection.focus.offset;
  const startOffset = Math.max(0, endOffset - insertedTextLength);

  if (endOffset <= startOffset) {
    return state;
  }

  return addEditorAnimation(state, {
    endOffset,
    kind: "inserted-text-highlight",
    regionPath: region.path,
    startOffset,
    startedAt,
  });
}

export function addDeletedTextFadeAnimation(
  state: EditorState,
  input: {
    regionPath: string;
    startOffset: number;
    text: string;
  },
  startedAt = getEditorAnimationTime(),
): EditorState {
  if (input.text.length === 0) {
    return state;
  }

  return addEditorAnimation(state, {
    kind: "deleted-text-fade",
    regionPath: input.regionPath,
    startOffset: input.startOffset,
    startedAt,
    text: input.text,
  });
}

export function addActiveBlockFlashAnimation(
  state: EditorState,
  blockPath: string,
  startedAt = getEditorAnimationTime(),
): EditorState {
  return addEditorAnimation(state, {
    blockPath,
    kind: "active-block-flash",
    startedAt,
  });
}

export function addPunctuationPulseAnimation(
  state: EditorState,
  startedAt = getEditorAnimationTime(),
): EditorState {
  const region = state.documentEditor.regionIndex.get(state.selection.focus.regionId);
  const offset = state.selection.focus.offset - 1;

  if (!region || offset < 0 || region.text[offset] !== ".") {
    return state;
  }

  return addEditorAnimation(state, {
    kind: "punctuation-pulse",
    offset,
    regionPath: region.path,
    startedAt,
  });
}

export function pushHistory(
  state: EditorState,
  document: Document,
  documentEditor: DocumentEditor | null = null,
  selection: CanvasSelection | EditorSelectionTarget | null = null,
): EditorState {
  const nextDocumentEditor = documentEditor ?? createDocumentEditor(document);
  const nextSelection =
    resolveSelectionTarget(nextDocumentEditor, selection) ??
    remapCollapsedSelection(state.selection, state.documentEditor, nextDocumentEditor) ??
    createCollapsedSelectionAtDefaultPoint(nextDocumentEditor);

  return {
    animations: pruneEditorAnimations(state.animations, getEditorAnimationTime()),
    future: [],
    documentEditor: nextDocumentEditor,
    history: [...state.history, state.documentEditor.document],
    selection: nextSelection,
  };
}

export function spliceEditorCommentThreads(
  state: EditorState,
  index: number,
  count: number,
  threads: CommentThread[],
): EditorState {
  const document = spliceCommentThreads(
    state.documentEditor.document,
    index,
    count,
    threads,
  );
  const documentEditor: DocumentEditor = {
    ...state.documentEditor,
    document,
  };

  return {
    animations: pruneEditorAnimations(state.animations, getEditorAnimationTime()),
    documentEditor,
    future: [],
    history: [...state.history, state.documentEditor.document],
    selection: state.selection,
  };
}

export function undoEditorState(state: EditorState): EditorState {
  const previous = state.history.at(-1);

  if (!previous) {
    return state;
  }

  const nextHistory = state.history.slice(0, -1);
  const documentEditor = createDocumentEditor(previous);

  return {
    animations: [],
    documentEditor,
    future: [state.documentEditor.document, ...state.future],
    history: nextHistory,
    selection:
      remapCollapsedSelection(state.selection, state.documentEditor, documentEditor) ??
      createCollapsedSelectionAtDefaultPoint(documentEditor),
  };
}

export function redoEditorState(state: EditorState): EditorState {
  const next = state.future[0];

  if (!next) {
    return state;
  }

  const documentEditor = createDocumentEditor(next);

  return {
    animations: [],
    documentEditor,
    future: state.future.slice(1),
    history: [...state.history, state.documentEditor.document],
    selection:
      remapCollapsedSelection(state.selection, state.documentEditor, documentEditor) ??
      createCollapsedSelectionAtDefaultPoint(documentEditor),
  };
}

function createCollapsedSelectionAtDefaultPoint(documentEditor: DocumentEditor): CanvasSelection {
  const point = resolveDefaultSelectionPoint(documentEditor);

  return {
    anchor: point,
    focus: point,
  };
}

function resolveDefaultSelectionPoint(documentEditor: DocumentEditor): CanvasSelectionPoint {
  return documentEditor.regions[0]
    ? { regionId: documentEditor.regions[0].id, offset: 0 }
    : { regionId: "empty", offset: 0 };
}

function remapCollapsedSelection(
  selection: CanvasSelection,
  previousRuntime: DocumentEditor,
  nextRuntime: DocumentEditor,
) {
  if (
    selection.anchor.regionId !== selection.focus.regionId ||
    selection.anchor.offset !== selection.focus.offset
  ) {
    return null;
  }

  const previousContainer = previousRuntime.regions.find(
    (container) => container.id === selection.anchor.regionId,
  );
  const nextContainer = nextRuntime.regions.find(
    (container) => container.path === previousContainer?.path,
  );

  if (!previousContainer || !nextContainer) {
    return null;
  }

  const offset = Math.min(selection.anchor.offset, nextContainer.text.length);
  const point = {
    regionId: nextContainer.id,
    offset,
  };

  return {
    anchor: point,
    focus: point,
  };
}

function clampSelectionPoint(
  documentEditor: DocumentEditor,
  point: CanvasSelectionPoint,
): CanvasSelectionPoint {
  const container = documentEditor.regions.find((entry) => entry.id === point.regionId);

  if (!container) {
    return point;
  }

  return {
    regionId: container.id,
    offset: Math.max(0, Math.min(point.offset, container.text.length)),
  };
}

function trimDocumentTrailingProseWhitespace(blocks: Block[]): Block[] {
  return blocks.map((block) => {
    switch (block.type) {
      case "blockquote":
        return {
          ...block,
          children: trimDocumentTrailingProseWhitespace(block.children),
        };
      case "heading":
      case "paragraph":
        return rebuildTextBlock(block, trimTrailingInlineWhitespace(block.children));
      case "list":
        return {
          ...block,
          children: block.children.map((item) => ({
            ...item,
            children: trimDocumentTrailingProseWhitespace(item.children),
          })),
        };
      case "listItem":
        return {
          ...block,
          children: trimDocumentTrailingProseWhitespace(block.children),
        };
      case "table":
        return rebuildTableBlock(
          block,
          block.rows.map<TableRow>((row) => ({
            ...row,
            cells: row.cells.map((cell) => ({
              ...cell,
              children: trimTrailingInlineWhitespace(cell.children),
            })),
          })),
        );
      default:
        return block;
    }
  });
}

function trimTrailingInlineWhitespace(nodes: Inline[]): Inline[] {
  const nextNodes = [...nodes];

  for (let index = nextNodes.length - 1; index >= 0; index -= 1) {
    const node = nextNodes[index]!;

    if (node.type === "text") {
      const trimmedText = node.text.replace(/[ \t]+$/u, "");

      if (trimmedText.length === node.text.length) {
        return nextNodes;
      }

      if (trimmedText.length === 0) {
        nextNodes.splice(index, 1);
        continue;
      }

      nextNodes[index] = {
        ...node,
        text: trimmedText,
      };

      return nextNodes;
    }

    if (node.type === "link") {
      const trimmedChildren = trimTrailingInlineWhitespace(node.children);

      if (
        trimmedChildren.length === node.children.length &&
        trimmedChildren.every((child, childIndex) => child === node.children[childIndex])
      ) {
        return nextNodes;
      }

      if (trimmedChildren.length === 0) {
        nextNodes.splice(index, 1);
        continue;
      }

      nextNodes[index] = {
        ...node,
        children: trimmedChildren,
      };

      return nextNodes;
    }

    return nextNodes;
  }

  return nextNodes;
}

function addEditorAnimation(
  state: EditorState,
  animation: EditorAnimation,
): EditorState {
  const activeAnimations = pruneEditorAnimations(
    state.animations,
    animation.startedAt,
  );

  return {
    ...state,
    animations: [
      ...activeAnimations,
      animation,
    ],
  };
}

function pruneEditorAnimations(
  animations: EditorAnimation[],
  now: number,
) {
  return animations.filter(
    (animation) => animation.startedAt + getEditorAnimationDuration(animation) > now,
  );
}

function getEditorAnimationTime() {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}
