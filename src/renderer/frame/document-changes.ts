import {
  resolveParentIndexedBlock,
  resolveIndexedBlock,
  type IndexedBlock,
  type EditorState,
} from "@/editor/state";
import type { EditorLayoutState } from "@/editor/layout";
import type { DocumentChange } from "@/document";
import type { ResolvedEditorTheme } from "../theme";
import type { DocumentChangeFadeFrame } from "../effects";
import { resolveTableCellGeometryFrame, type TableCellGeometryFrame } from "./chrome/table";

export type DocumentChangeFrameEntry = {
  kind: DocumentChange["kind"];
  fade: DocumentChangeFadeFrame | null;
};

export type DocumentChangeFrameInput = DocumentChange & {
  // Present only for live changes, whose introduction fades once.
  readonly changeKey?: string;
};

export type TableCellDocumentChangeFrame = TableCellGeometryFrame & {
  readonly color: string;
  readonly opacity: ReturnType<typeof resolveDocumentChangeOpacity>;
};

type DocumentChangeFrameIndex = {
  blockChanges: ReadonlyMap<string, DocumentChangeFrameEntry>;
  tableCellChanges: ReadonlyMap<string, DocumentChangeFrameEntry>;
};

export type DocumentChangeResolver = (
  editorState: EditorState,
  indexedBlock: IndexedBlock | null,
  path: string,
) => DocumentChangeFrameEntry | null;

export function createDocumentChangeResolver(
  changes: readonly DocumentChangeFrameInput[] = [],
  fades: ReadonlyMap<string, DocumentChangeFadeFrame> = new Map(),
): DocumentChangeResolver {
  if (changes.length === 0) {
    return emptyDocumentChangeResolver;
  }

  const index = createDocumentChangeFrameIndex(changes, fades);
  const blockChangesByPath = new Map<string, DocumentChangeFrameEntry | null>();

  return (editorState, indexedBlock, path) => {
    const tableCellChange =
      index.tableCellChanges.size > 0 ? (index.tableCellChanges.get(path) ?? null) : null;

    if (tableCellChange || index.blockChanges.size === 0 || !indexedBlock) {
      return tableCellChange;
    }

    if (blockChangesByPath.has(indexedBlock.path)) {
      return blockChangesByPath.get(indexedBlock.path) ?? null;
    }

    const blockChange = resolveDocumentChangeForIndexedBlock(editorState, indexedBlock, index);
    blockChangesByPath.set(indexedBlock.path, blockChange);
    return blockChange;
  };
}

const emptyDocumentChangeResolver: DocumentChangeResolver = () => null;

function createDocumentChangeFrameIndex(
  changes: readonly DocumentChangeFrameInput[],
  fades: ReadonlyMap<string, DocumentChangeFadeFrame>,
): DocumentChangeFrameIndex {
  const blockChanges = new Map<string, DocumentChangeFrameEntry>();
  const tableCellChanges = new Map<string, DocumentChangeFrameEntry>();

  for (const change of changes) {
    const entry = {
      fade: change.changeKey ? (fades.get(change.changeKey) ?? null) : null,
      kind: change.kind,
    } satisfies DocumentChangeFrameEntry;

    if (change.anchor.kind === "block") {
      blockChanges.set(change.anchor.path, entry);
    } else {
      tableCellChanges.set(change.anchor.path, entry);
    }
  }

  return {
    blockChanges,
    tableCellChanges,
  };
}

function resolveDocumentChangeForIndexedBlock(
  editorState: EditorState,
  indexedBlock: IndexedBlock,
  index: DocumentChangeFrameIndex,
): DocumentChangeFrameEntry | null {
  let current: IndexedBlock | null = indexedBlock;

  while (current) {
    const change = index.blockChanges.get(current.path);

    if (change) {
      return change;
    }

    current = resolveParentIndexedBlock(editorState.documentIndex, current);
  }

  return null;
}

export function resolveDocumentChangeBackgroundColor(
  change: DocumentChangeFrameEntry,
  theme: ResolvedEditorTheme,
) {
  switch (change.kind) {
    case "added":
      return theme.externalChangeAdditionBackground;
    case "deleted":
      return theme.externalChangeDeletionBackground;
    case "modified":
      return theme.externalChangeModificationBackground;
  }
}

export function resolveDocumentChangeOpacity(change: DocumentChangeFrameEntry) {
  return change.fade ? change.fade.progress : undefined;
}

export function resolveTableCellDocumentChanges({
  editorState,
  endLineIndex,
  layoutState,
  resolveDocumentChange,
  startLineIndex,
  theme,
}: {
  editorState: EditorState;
  endLineIndex: number;
  layoutState: EditorLayoutState;
  resolveDocumentChange: DocumentChangeResolver;
  startLineIndex: number;
  theme: ResolvedEditorTheme;
}): TableCellDocumentChangeFrame[] {
  const { layout } = layoutState;
  const frames: TableCellDocumentChangeFrame[] = [];
  const visitedPaths = new Set<string>();

  for (let index = startLineIndex; index < endLineIndex; index += 1) {
    const line = layout.lines[index]!;
    if (line.blockPath === null) {
      continue;
    }
    const indexedBlock = resolveIndexedBlock(editorState.documentIndex, line.blockPath);

    if (indexedBlock?.block.type !== "table" || visitedPaths.has(line.path)) {
      continue;
    }

    const change = resolveDocumentChange(editorState, indexedBlock, line.path);
    if (!change) {
      continue;
    }

    const geometry = resolveTableCellGeometryFrame({
      endLineIndex,
      layout,
      path: line.path,
      startLineIndex,
    });

    if (!geometry) {
      continue;
    }

    visitedPaths.add(line.path);
    frames.push({
      ...geometry,
      color: resolveDocumentChangeBackgroundColor(change, theme),
      opacity: resolveDocumentChangeOpacity(change),
    });
  }

  return frames;
}
