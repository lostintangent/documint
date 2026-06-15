import type { EditorEffect } from "@/editor/state";
import type { DocumintEffects } from "@/types";

export type ActiveEditorEffect = EditorEffect & {
  startedAt: number;
};

export type EffectFrame<TKind extends keyof DocumintEffects> = {
  customEffectName: TKind;
  defaultEnabled: boolean;
};

export type BlockFlashFrame = EffectFrame<"activeBlockChanged"> & {
  blockPath: string;
  progress: number;
};

export type TextFadeFrame = EffectFrame<"textDeleted"> & {
  contentKind: "code" | "text";
  progress: number;
  regionPath: string;
  startOffset: number;
  text: string;
};

type TextInsertionFrame = EffectFrame<"textInserted"> & {
  contentKind: "code" | "text";
  endOffset: number;
  progress: number;
  regionPath: string;
  startOffset: number;
  text: string;
};

export type TextHighlightFrame = TextInsertionFrame;

export type BlockPulseFrame = EffectFrame<"listItemInserted"> & {
  blockPath: string;
  progress: number;
};

export type TextPulseFrame = TextInsertionFrame;
