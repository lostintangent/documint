import type { TextRangeContext } from "../../context";
import type { DocumentIndex } from "../../../index/types";
import type { EditorSelection } from "../../../selection";
import type { EditorStateAction } from "../../../types";
import {
  resolveTextInsertedEffect,
  resolveTextInsertedEffectForRegion,
} from "../../../effects";

export function resolveTextReplacement(
  documentIndex: DocumentIndex,
  selection: EditorSelection,
  text: string,
): EditorStateAction {
  return {
    effect: resolveTextInsertedEffect(documentIndex, selection, text),
    kind: "splice-text",
    text,
  };
}

export function resolveTextRangeReplacement(
  context: TextRangeContext,
  text: string,
): EditorStateAction {
  return {
    effect: resolveTextInsertedEffectForRegion(context.region, context.startOffset, text),
    kind: "splice-text",
    range: context.selection,
    text,
  };
}
