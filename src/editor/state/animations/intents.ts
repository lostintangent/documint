// Animation intent resolution. These helpers are used by action resolvers and
// fragment policy to declare semantic animation intent; reducers materialize
// the intent into runtime animation descriptors after the edit is applied.

import { containsColorEmoji } from "../../text/emoji";
import type { DocumentIndex, EditorRegion } from "../index/types";
import {
  normalizeSelection,
  resolveRegion,
  type EditorSelection,
  type NormalizedEditorSelection,
} from "../selection";
import type { AnimationIntent } from "../types";

export function resolveInlineInsertionAnimation(
  documentIndex: DocumentIndex,
  selection: EditorSelection,
  insertedText: string,
): AnimationIntent | undefined {
  if (insertedText === ".") {
    return resolveTextPulseAnimation(documentIndex, selection);
  }

  return resolveTextHighlightAnimation(documentIndex, selection, insertedText);
}

export function resolveTextHighlightAnimation(
  documentIndex: DocumentIndex,
  selection: EditorSelection,
  insertedText: string,
): AnimationIntent | undefined {
  if (insertedText.length === 0 || containsColorEmoji(insertedText)) {
    return undefined;
  }

  const context = resolveSameRegionSelectionContext(documentIndex, selection);

  if (!context) {
    return undefined;
  }

  return resolveTextHighlightAnimationForRegion(
    context.region,
    context.normalized.start.offset,
    insertedText,
  );
}

export function resolveTextHighlightAnimationForRegion(
  region: EditorRegion,
  startOffset: number,
  insertedText: string,
): AnimationIntent | undefined {
  if (insertedText.length === 0 || containsColorEmoji(insertedText)) {
    return undefined;
  }

  return {
    endOffset: startOffset + insertedText.length,
    kind: "text-highlight",
    regionPath: region.path,
    startOffset,
  };
}

export function resolveTextFadeAnimation(
  region: EditorRegion,
  startOffset: number,
  endOffset: number,
): AnimationIntent | undefined {
  const text = region.text.slice(startOffset, endOffset);

  if (text.length === 0 || containsColorEmoji(text)) {
    return undefined;
  }

  const isPlainText = region.inlines.some(
    (entry) =>
      entry.start <= startOffset &&
      entry.end >= endOffset &&
      entry.kind === "text" &&
      entry.link === null &&
      entry.marks.length === 0,
  );

  return isPlainText
    ? {
        kind: "text-fade",
        regionPath: region.path,
        startOffset,
        text,
      }
    : undefined;
}

function resolveTextPulseAnimation(
  documentIndex: DocumentIndex,
  selection: EditorSelection,
): AnimationIntent | undefined {
  const context = resolveSameRegionSelectionContext(documentIndex, selection);

  if (!context) {
    return undefined;
  }

  return {
    kind: "text-pulse",
    offset: context.normalized.start.offset,
    regionPath: context.region.path,
  };
}

function resolveSameRegionSelectionContext(
  documentIndex: DocumentIndex,
  selection: EditorSelection,
): { normalized: NormalizedEditorSelection; region: EditorRegion } | null {
  const normalized = normalizeSelection(documentIndex, selection);

  if (normalized.start.regionId !== normalized.end.regionId) {
    return null;
  }

  const region = resolveRegion(documentIndex, normalized.start.regionId);
  return region ? { normalized, region } : null;
}
