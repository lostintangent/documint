import type { EditorState } from "./types";
import { regionInlines } from "./index/inlines";
import { isInlineRegion } from "./index/query";
import type { DocumentIndex, EditableRegion } from "./index/types";
import {
  normalizeSelection,
  resolveRegion,
  type EditorSelection,
  type NormalizedEditorSelection,
} from "./selection";

export type TextInsertedEffect = {
  kind: "text-inserted";
  text: string;
  regionPath: string;
  startOffset: number;
  endOffset: number;
};

export type TextDeletedEffect = {
  kind: "text-deleted";
  text: string;
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

export function resolveTextInsertedEffect(
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

export function resolveTextInsertedEffectForRegion(
  region: EditableRegion,
  startOffset: number,
  insertedText: string,
): TextInsertedEffect | undefined {
  if (!isInlineRegion(region) || insertedText.length === 0) {
    return undefined;
  }

  return {
    kind: "text-inserted",
    text: insertedText,
    regionPath: region.path,
    startOffset,
    endOffset: startOffset + insertedText.length,
  };
}

export function resolveTextDeletedEffect(
  region: EditableRegion,
  startOffset: number,
  endOffset: number,
  direction: "backward" | "forward",
  placement: "line-end" | "line-middle" | "soft-line-break",
): TextDeletedEffect | undefined {
  const text = region.text.slice(startOffset, endOffset);

  if (text.length === 0 || !isInlineRegion(region)) {
    return undefined;
  }

  const isPlainText = regionInlines(region).some(
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
