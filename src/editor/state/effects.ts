// Semantic editor effects produced by state transitions. These are durable
// state-layer facts for the host/renderer to interpret; timing and animation
// policy live outside this subsystem.

import type { Block } from "@/document";
import type { DocumentIndex } from "./index/types";
import {
  resolveIndexedText,
  resolveIndexedTextInlines,
  resolveIndexedTextKind,
} from "./index/query";
import { normalizeSelection, type EditorSelection } from "./selection";
import type { EditorState } from "./types";

type TextEffectContentKind = "inlines" | "metadata" | "source";

export type TextInsertedEffect = {
  kind: "text-inserted";
  text: string;
  contentKind: TextEffectContentKind;
  path: string;
  startOffset: number;
  endOffset: number;
};

export type DeletionDirection = "backward" | "forward";

export type TextDeletedEffect = {
  kind: "text-deleted";
  text: string;
  contentKind: TextEffectContentKind;
  path: string;
  startOffset: number;
  direction: DeletionDirection;
  placement: "line-end" | "line-middle" | "soft-line-break";
  textKind: "plain" | "styled";
};

type ListItemInsertedEffect = {
  kind: "list-item-inserted";
  blockPath: string;
};

type ActiveBlockChangedEffect = {
  kind: "active-block-changed";
  blockPath: string;
};

export type EditorEffect =
  | ActiveBlockChangedEffect
  | ListItemInsertedEffect
  | TextDeletedEffect
  | TextInsertedEffect;

export type BlockReferencedListItemInsertedEffect = {
  block: Block;
  kind: "list-item-inserted-block";
};

// Action-facing effect vocabulary. Commands use this to declare semantic edit
// effects; helpers return `undefined` when the edit is not renderable as that
// effect kind.
export const effect = {
  // Text inserted into the current selection. Used by ordinary typing and
  // inline paste highlights.
  textInsertedAtSelection(
    documentIndex: DocumentIndex,
    selection: EditorSelection,
    insertedText: string,
  ): TextInsertedEffect | undefined {
    if (insertedText.length === 0) {
      return undefined;
    }

    const normalized = normalizeSelection(documentIndex, selection);

    return normalized.start.path === normalized.end.path
      ? effect.textInsertedAtPath(
          documentIndex,
          normalized.start.path,
          normalized.start.offset,
          insertedText,
        )
      : undefined;
  },

  // Text inserted into a known path. Used when the command has already resolved
  // the target and can avoid re-normalizing selection.
  textInsertedAtPath(
    documentIndex: DocumentIndex,
    path: string,
    startOffset: number,
    insertedText: string,
  ): TextInsertedEffect | undefined {
    const indexedText = resolveIndexedText(documentIndex, path);

    if (!indexedText || insertedText.length === 0) {
      return undefined;
    }

    return {
      kind: "text-inserted",
      text: insertedText,
      contentKind: resolveIndexedTextKind(indexedText),
      path,
      startOffset,
      endOffset: startOffset + insertedText.length,
    };
  },

  // Text deleted from a known path. Used by character deletion,
  // which computes grapheme boundaries before creating the splice action.
  textDeletedAtPath(
    documentIndex: DocumentIndex,
    path: string,
    startOffset: number,
    endOffset: number,
    direction: DeletionDirection,
    placement: "line-end" | "line-middle" | "soft-line-break",
  ): TextDeletedEffect | undefined {
    const indexedText = resolveIndexedText(documentIndex, path);

    if (!indexedText) {
      return undefined;
    }

    const text = indexedText.text.slice(startOffset, endOffset);

    if (text.length === 0) {
      return undefined;
    }

    const inlines = resolveIndexedTextInlines(indexedText);
    const isPlainText =
      inlines === null ||
      inlines.some(
        (entry) =>
          entry.start <= startOffset &&
          entry.end >= endOffset &&
          entry.node.type === "text" &&
          entry.link === null &&
          entry.node.marks.length === 0,
      );

    return {
      kind: "text-deleted",
      text,
      contentKind: resolveIndexedTextKind(indexedText),
      path,
      startOffset,
      direction,
      placement,
      textKind: isPlainText ? "plain" : "styled",
    };
  },

  // List item inserted from a block included in this action's payload.
  // Dispatch materializes the block reference into the committed block path
  // before exposing it as an `EditorEffect`.
  listItemInserted(block: Block): BlockReferencedListItemInsertedEffect {
    return { block, kind: "list-item-inserted-block" };
  },
};

// Effects are the state layer's one side channel: callers may attach semantic
// events to a returned EditorState, but no-op actions must not emit effects
// onto a reused snapshot. Producers only build renderable effects (non-empty
// text, real block paths), so recording does not re-validate them.
const editorEffects = new WeakMap<EditorState, readonly EditorEffect[]>();

export function recordEditorEffects(
  state: EditorState,
  effects: readonly EditorEffect[],
): EditorState {
  if (effects.length === 0) {
    return state;
  }

  const existing = editorEffects.get(state) ?? [];
  editorEffects.set(state, [...existing, ...effects]);
  return state;
}

export function readEditorEffects(state: EditorState): readonly EditorEffect[] {
  return editorEffects.get(state) ?? [];
}

export function takeEditorEffects(state: EditorState): readonly EditorEffect[] {
  const effects = readEditorEffects(state);
  editorEffects.delete(state);
  return effects;
}
