import {
  resolveParentIndexedBlock,
  resolveIndexedBlock,
  type IndexedBlock,
  type EditorState,
} from "@/editor/state";
import type { DocumentChange } from "@/document";
import type { ResolvedEditorTheme } from "../theme";
import type { DocumentChangeFadeFrame } from "../effects";
import {
  resolveTableCellGeometryFrame,
  type TableCellChromeFrame,
  type TableCellGeometryFrame,
} from "./chrome/table";

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

export type DocumentChangeResolver = (
  editorState: EditorState,
  indexedBlock: IndexedBlock | null,
  path: string,
) => DocumentChangeFrameEntry | null;

export function createDocumentChangeResolver(
  changes: readonly DocumentChangeFrameInput[],
  fades: ReadonlyMap<string, DocumentChangeFadeFrame>,
): DocumentChangeResolver {
  if (changes.length === 0) {
    return emptyDocumentChangeResolver;
  }

  const blockChanges = new Map<string, DocumentChangeFrameEntry>();
  const tableCellChanges = new Map<string, DocumentChangeFrameEntry>();

  for (const change of changes) {
    const entry = {
      fade: change.changeKey ? (fades.get(change.changeKey) ?? null) : null,
      kind: change.kind,
    } satisfies DocumentChangeFrameEntry;

    (change.anchor.kind === "block" ? blockChanges : tableCellChanges).set(
      change.anchor.path,
      entry,
    );
  }

  // Lines of one block share its nearest changed ancestor, so memoize by block.
  const blockChangesByPath = new Map<string, DocumentChangeFrameEntry | null>();

  return (editorState, indexedBlock, path) => {
    const tableCellChange = tableCellChanges.get(path) ?? null;

    if (tableCellChange || blockChanges.size === 0 || !indexedBlock) {
      return tableCellChange;
    }

    if (blockChangesByPath.has(indexedBlock.path)) {
      return blockChangesByPath.get(indexedBlock.path) ?? null;
    }

    let current: IndexedBlock | null = indexedBlock;

    while (current && !blockChanges.has(current.path)) {
      current = resolveParentIndexedBlock(editorState.documentIndex, current);
    }

    const blockChange = (current && blockChanges.get(current.path)) ?? null;
    blockChangesByPath.set(indexedBlock.path, blockChange);
    return blockChange;
  };
}

const emptyDocumentChangeResolver: DocumentChangeResolver = () => null;

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
  cells,
  editorState,
  resolveDocumentChange,
  theme,
}: {
  cells: readonly TableCellChromeFrame[];
  editorState: EditorState;
  resolveDocumentChange: DocumentChangeResolver;
  theme: ResolvedEditorTheme;
}): TableCellDocumentChangeFrame[] {
  const frames: TableCellDocumentChangeFrame[] = [];

  for (const cell of cells) {
    const table = resolveIndexedBlock(editorState.documentIndex, cell.blockPath);
    const change = resolveDocumentChange(editorState, table, cell.path);

    if (change) {
      frames.push({
        ...resolveTableCellGeometryFrame(cell),
        color: resolveDocumentChangeBackgroundColor(change, theme),
        opacity: resolveDocumentChangeOpacity(change),
      });
    }
  }

  return frames;
}
