// Semantic editor effects produced by state transitions. These are durable
// state-layer facts for the host/renderer to interpret; timing and animation
// policy live outside this subsystem.

import type { Block } from "@/document";
import { regionInlines } from "./index/inlines";
import type { DocumentIndex, EditableRegion } from "./index/types";
import {
  normalizeSelection,
  resolveRegion,
  type EditorSelection,
  type NormalizedEditorSelection,
} from "./selection";
import type { EditorState } from "./types";

export type TextInsertedEffect = {
  kind: "text-inserted";
  text: string;
  regionKind: EditableRegion["content"]["kind"];
  regionPath: string;
  startOffset: number;
  endOffset: number;
};

export type TextDeletedEffect = {
  kind: "text-deleted";
  text: string;
  regionKind: EditableRegion["content"]["kind"];
  regionPath: string;
  startOffset: number;
  direction: "backward" | "forward";
  placement: "line-end" | "line-middle" | "soft-line-break";
  textKind: "plain" | "styled";
};

export type ListItemInsertedEffect = {
  kind: "list-item-inserted";
  blockPath: string;
};

export type ActiveBlockChangedEffect = {
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
    return resolveTextInsertedEffect(documentIndex, selection, insertedText);
  },

  // Text inserted into a known editable region. Used when the command already
  // resolved the target region and can avoid re-normalizing selection.
  textInsertedAtRegion(
    region: EditableRegion,
    startOffset: number,
    insertedText: string,
  ): TextInsertedEffect | undefined {
    return resolveTextInsertedEffectForRegion(region, startOffset, insertedText);
  },

  // Text deleted from a known editable region. Used by character deletion,
  // which computes grapheme boundaries before creating the splice action.
  textDeleted(
    region: EditableRegion,
    startOffset: number,
    endOffset: number,
    direction: "backward" | "forward",
    placement: "line-end" | "line-middle" | "soft-line-break",
  ): TextDeletedEffect | undefined {
    return resolveTextDeletedEffect(region, startOffset, endOffset, direction, placement);
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
// onto a reused snapshot.
const editorEffects = new WeakMap<EditorState, readonly EditorEffect[]>();

export function recordEditorEffects(
  state: EditorState,
  effects: readonly EditorEffect[],
): EditorState {
  if (effects.length === 0) {
    return state;
  }

  const validEffects = effects.filter(isValidEditorEffect);

  if (validEffects.length === 0) {
    return state;
  }

  const existing = editorEffects.get(state) ?? [];
  editorEffects.set(state, [...existing, ...validEffects]);
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

function resolveTextInsertedEffect(
  documentIndex: DocumentIndex,
  selection: EditorSelection,
  insertedText: string,
): TextInsertedEffect | undefined {
  if (insertedText.length === 0) {
    return undefined;
  }

  const context = resolveSameRegionSelectionContext(documentIndex, selection);

  if (!context) {
    return undefined;
  }

  return resolveTextInsertedEffectForRegion(
    context.region,
    context.normalized.start.offset,
    insertedText,
  );
}

function resolveTextInsertedEffectForRegion(
  region: EditableRegion,
  startOffset: number,
  insertedText: string,
): TextInsertedEffect | undefined {
  if (insertedText.length === 0) {
    return undefined;
  }

  return {
    kind: "text-inserted",
    text: insertedText,
    regionKind: region.content.kind,
    regionPath: region.path,
    startOffset,
    endOffset: startOffset + insertedText.length,
  };
}

function resolveTextDeletedEffect(
  region: EditableRegion,
  startOffset: number,
  endOffset: number,
  direction: "backward" | "forward",
  placement: "line-end" | "line-middle" | "soft-line-break",
): TextDeletedEffect | undefined {
  const text = region.text.slice(startOffset, endOffset);

  if (text.length === 0) {
    return undefined;
  }

  const isPlainText =
    region.content.kind === "source" ||
    regionInlines(region).some(
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
    regionKind: region.content.kind,
    regionPath: region.path,
    startOffset,
    direction,
    placement,
    textKind: isPlainText ? "plain" : "styled",
  };
}

function isValidEditorEffect(effect: EditorEffect): boolean {
  switch (effect.kind) {
    case "active-block-changed":
    case "list-item-inserted":
      return effect.blockPath.length > 0;
    case "text-deleted":
    case "text-inserted":
      return effect.text.length > 0;
  }
}

function resolveSameRegionSelectionContext(
  documentIndex: DocumentIndex,
  selection: EditorSelection,
): { normalized: NormalizedEditorSelection; region: EditableRegion } | null {
  const normalized = normalizeSelection(documentIndex, selection);

  if (normalized.start.regionId !== normalized.end.regionId) {
    return null;
  }

  const region = resolveRegion(documentIndex, normalized.start.regionId);
  return region ? { normalized, region } : null;
}
