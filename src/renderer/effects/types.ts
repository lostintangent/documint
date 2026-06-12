import type { EditorEffect } from "@/editor/state";

export type ActiveEditorEffect = EditorEffect & {
  startedAt: number;
};

export type ActiveBlockFlash = {
  blockPath: string;
  progress: number;
};

export type ActiveTextFade = {
  progress: number;
  regionPath: string;
  startOffset: number;
  text: string;
};

export type ActiveTextInsertion = {
  endOffset: number;
  progress: number;
  regionPath: string;
  startOffset: number;
  text: string;
};

export type ActiveTextHighlight = ActiveTextInsertion;

export type ActiveBlockPulse = {
  blockPath: string;
  progress: number;
};

export type ActiveTextPulse = ActiveTextInsertion;
