import {
  resolveParentIndexedBlock,
  resolveIndexedBlock,
  type IndexedBlock,
  type EditorState,
} from "@/editor/state";
import type { EditorLayoutState } from "@/editor/layout";
import type { DocumentChangeKind } from "@/document";
import { type ResolvedDocumentChangeTarget, type ResolvedEditorTheme } from "@/types";
import {
  documentChangeFrameTargetKey,
  type DocumentChangeFadeFrame,
} from "../effects";
import {
  resolveTableCellGeometryFrame,
  type TableCellGeometryFrame,
} from "./chrome/table";

export type DocumentChangeFrameEntry = {
  changeKind: DocumentChangeKind;
  fade: DocumentChangeFadeFrame | null;
};

export type DocumentChangeFrameInput =
  ResolvedDocumentChangeTarget & {
    changeKind: DocumentChangeKind;
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
  regionId: string,
) => DocumentChangeFrameEntry | null;

export function createDocumentChangeResolver(
  changes: readonly DocumentChangeFrameInput[] = [],
  fades: ReadonlyMap<string, DocumentChangeFadeFrame> = new Map(),
): DocumentChangeResolver {
  if (changes.length === 0) {
    return emptyDocumentChangeResolver;
  }

  const index = createDocumentChangeFrameIndex(changes, fades);
  const blockChangesByBlockId = new Map<string, DocumentChangeFrameEntry | null>();

  return (editorState, indexedBlock, regionId) => {
    const tableCellChange = index.tableCellChanges.size > 0
      ? (index.tableCellChanges.get(regionId) ?? null)
      : null;

    if (tableCellChange || index.blockChanges.size === 0 || !indexedBlock) {
      return tableCellChange;
    }

    const blockId = indexedBlock.block.id;
    if (blockChangesByBlockId.has(blockId)) {
      return blockChangesByBlockId.get(blockId) ?? null;
    }

    const blockChange = resolveDocumentChangeForIndexedBlock(editorState, indexedBlock, index);
    blockChangesByBlockId.set(blockId, blockChange);
    return blockChange;
  };
}

const emptyDocumentChangeResolver: DocumentChangeResolver = () => null;

function createDocumentChangeFrameIndex(
  changes: readonly DocumentChangeFrameInput[] = [],
  fades: ReadonlyMap<string, DocumentChangeFadeFrame>,
): DocumentChangeFrameIndex {
  const blockChanges = new Map<string, DocumentChangeFrameEntry>();
  const tableCellChanges = new Map<string, DocumentChangeFrameEntry>();

  for (const target of changes) {
    const entry = {
      changeKind: target.changeKind,
      fade: fades.get(documentChangeFrameTargetKey(target)) ?? null,
    } satisfies DocumentChangeFrameEntry;

    if (target.kind === "block") {
      blockChanges.set(target.blockId, entry);
    } else {
      tableCellChanges.set(target.regionId, entry);
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
    const change = index.blockChanges.get(current.block.id);

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
  return change.changeKind === "added"
    ? theme.externalChangeAdditionBackground
    : theme.externalChangeModificationBackground;
}

export function resolveDocumentChangeOpacity(
  change: DocumentChangeFrameEntry,
) {
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
  const visitedRegionIds = new Set<string>();

  for (let index = startLineIndex; index < endLineIndex; index += 1) {
    const line = layout.lines[index]!;
    const indexedBlock = resolveIndexedBlock(editorState.documentIndex, line.blockId);

    if (indexedBlock?.block.type !== "table" || visitedRegionIds.has(line.regionId)) {
      continue;
    }

    const change = resolveDocumentChange(editorState, indexedBlock, line.regionId);
    if (!change) {
      continue;
    }

    const geometry = resolveTableCellGeometryFrame({
      endLineIndex,
      layout,
      regionBounds: layout.regionBounds,
      regionId: line.regionId,
      startLineIndex,
    });

    if (!geometry) {
      continue;
    }

    visitedRegionIds.add(line.regionId);
    frames.push({
      ...geometry,
      color: resolveDocumentChangeBackgroundColor(change, theme),
      opacity: resolveDocumentChangeOpacity(change),
    });
  }

  return frames;
}
