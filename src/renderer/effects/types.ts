import type { EditorEffect } from "@/editor/state";
import type { DocumentChangeKind } from "@/document";
import type { DocumintEffects, ResolvedDocumentChangeTarget } from "@/types";

export type DocumentChangeEffect = {
  changeKind: DocumentChangeKind;
  kind: "document-change";
  target: ResolvedDocumentChangeTarget;
};

export type RendererEffectInput = EditorEffect | DocumentChangeEffect;

export type RendererEffect = RendererEffectInput & {
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

export type DocumentChangeFadeFrame = {
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

export function documentChangeFrameTargetKey(target: ResolvedDocumentChangeTarget) {
  return target.kind === "block" ? `block:${target.blockId}` : `table-cell:${target.regionId}`;
}
