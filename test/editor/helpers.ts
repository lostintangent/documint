// Setup and selection primitives shared by every subsystem under
// `test/editor/`. Crosses the markdown ↔ document ↔ editor seam.

import {
  createEditorState,
  metadataKeyPath,
  metadataValuePath,
  resolveMetadataField,
  setSelection,
  type DocumentIndex,
  type IndexedBlock,
  type IndexedInline,
  type IndexedTableCell,
  type EditorState,
} from "@/editor/state";
import type { EditorPresence } from "@/editor/anchors";
import { parseDocument, serializeDocument, type MarkdownOptions } from "@/markdown";
import type { Block } from "@/document";
import type { DocumentResourceIcon, DocumentResources } from "@/editor";

/** Create an editor state from a markdown string. */
export function setup(markdown: string, options?: MarkdownOptions): EditorState {
  return createEditorState(parseDocument(markdown, options));
}

/** Serialize an editor state back to a markdown string. */
export function toMarkdown(state: EditorState): string {
  return serializeDocument(state.documentIndex.document);
}

export type IndexedTextEntry = {
  block: Block;
  blockPath: string;
  inlines: readonly IndexedInline[] | null;
  path: string;
  tableCell: IndexedTableCell | null;
  text: string;
};

export function getMetadataEntry(
  state: EditorState,
  fieldIndex: number,
  type: "boolean" | "key" | "value",
): { path: string; record: NonNullable<ReturnType<typeof resolveMetadataField>> } {
  const path = type === "key" ? metadataKeyPath(fieldIndex) : metadataValuePath(fieldIndex);
  const record = resolveMetadataField(state.documentIndex, path);

  if (!record || record.type !== type) {
    throw new Error(`Expected metadata field ${fieldIndex} ${type} entry`);
  }

  return { path, record };
}

/** Project the editor's selectable text paths from the block index. */
export function indexedTextEntries(stateOrIndex: EditorState | DocumentIndex): IndexedTextEntry[] {
  const documentIndex = "documentIndex" in stateOrIndex ? stateOrIndex.documentIndex : stateOrIndex;
  const paths: IndexedTextEntry[] = [];

  for (const block of documentIndex.blocks) {
    if (block.kind === "inlines") {
      paths.push(pathHandle(block, block.path, block.text, block.inlines, null));
      continue;
    }

    if (block.kind === "source") {
      paths.push(pathHandle(block, block.path, block.text, null, null));
      continue;
    }

    if (block.kind !== "cells") {
      continue;
    }

    for (const row of block.tableCellRows) {
      for (const cell of row) {
        paths.push(pathHandle(block, cell.path, cell.text, cell.inlines, cell));
      }
    }
  }

  return paths;
}

function pathHandle(
  block: IndexedBlock,
  path: string,
  text: string,
  inlines: readonly IndexedInline[] | null,
  tableCell: IndexedTableCell | null,
): IndexedTextEntry {
  return {
    block: block.block,
    blockPath: block.path,
    inlines,
    path,
    tableCell,
    text,
  };
}

/**
 * Find a text path by its plain-text content. Throws if not found.
 * Pass an empty string to find the first text container whose content is empty.
 */
export function getPath(stateOrIndex: EditorState | DocumentIndex, text: string): IndexedTextEntry {
  const path = indexedTextEntries(stateOrIndex).find((entry) => entry.text === text);

  if (!path) {
    throw new Error(`Expected path with text "${text}"`);
  }

  return path;
}

/**
 * Find the first path of a given block type. Used when a fixture has a
 * single block of a particular kind (heading, code block, etc.) and the
 * test wants to locate it independent of its content.
 */
export function getPathByType(state: EditorState, blockType: string): IndexedTextEntry {
  const path = indexedTextEntries(state).find((entry) => entry.block.type === blockType);

  if (!path) {
    throw new Error(`Expected path with block type "${blockType}"`);
  }

  return path;
}

/**
 * Place a collapsed caret at the given offset in a path.
 * Pass "start" for 0 or "end" for text.length.
 */
export function placeAt(
  state: EditorState,
  path: IndexedTextEntry,
  offset: number | "start" | "end",
): EditorState {
  const resolvedOffset = offset === "start" ? 0 : offset === "end" ? path.text.length : offset;

  return setSelection(state, { path: path.path, offset: resolvedOffset });
}

/**
 * Expand the selection to a character range within a single path.
 * start and end are offsets into path.text.
 */
export function selectIn(
  state: EditorState,
  path: IndexedTextEntry,
  start: number,
  end: number,
): EditorState {
  return setSelection(state, {
    anchor: { path: path.path, offset: start },
    focus: { path: path.path, offset: end },
  });
}

/**
 * Select a substring within a path by value.
 * selectSubstring(state, path, "world") selects the first occurrence of "world".
 */
export function selectSubstring(
  state: EditorState,
  path: IndexedTextEntry,
  substring: string,
): EditorState {
  const start = path.text.indexOf(substring);

  if (start === -1) {
    throw new Error(`"${substring}" not found in path text "${path.text}"`);
  }

  return selectIn(state, path, start, start + substring.length);
}

/**
 * Create document resources from active resource URLs, protocol icons, and
 * loaded image sizes. Registers a `demo-resource:` protocol by default.
 */
export function createResources({
  active = [],
  images = {},
  protocols = { "demo-resource:": "R" },
}: {
  active?: string[];
  images?: Record<string, { height: number; width: number }>;
  protocols?: Record<string, DocumentResourceIcon | undefined>;
} = {}): DocumentResources {
  return {
    images: new Map(
      Object.entries(images).map(([url, { height, width }]) => [
        url,
        { intrinsicHeight: height, intrinsicWidth: width, source: null, status: "loaded" },
      ]),
    ),
    resourceRegistry: {
      active: new Set(active),
      protocols: new Map(
        Object.entries(protocols).map(([protocol, icon]) => [
          protocol,
          { icon, label: "Demo resource" },
        ]),
      ),
    },
  };
}

/** Create a remote presence, optionally on a comment thread or at a cursor point. */
export function createPresence({
  color,
  commentThreadIndex = null,
  cursorPoint = null,
}: Partial<
  Pick<EditorPresence, "color" | "commentThreadIndex" | "cursorPoint">
> = {}): EditorPresence {
  return {
    color,
    commentThreadIndex,
    cursorPoint,
    id: "presence",
    isOnUnresolvedCommentThread: commentThreadIndex !== null,
    username: "Presence",
    viewport: null,
  };
}
