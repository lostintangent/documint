import type { LayoutRect } from "@/editor/layout";
import type { EditorEffect } from "@/editor/state";
import type { ResolvedEditorTheme } from "../theme";

// --- Custom effect handlers ---
//
// Hosts can replace or wrap a built-in effect's paint through `DocumintEffects`.
// Each handler receives the canvas environment plus that effect's progress.

export type EffectEnvironment = {
  context: CanvasRenderingContext2D;
  theme: ResolvedEditorTheme;
  viewport: LayoutRect;
};

type EffectContext<TFields = object> = EffectEnvironment & TFields;

type EffectComposition = "after" | "before" | "replace";

export type DocumintEffectHandler<TContext> =
  | ((context: TContext) => void)
  | {
      compose?: EffectComposition;
      paint: (context: TContext) => void;
    };

export type ActiveBlockChangedEffectContext = EffectContext<{
  progress: number;
  rect: LayoutRect;
}>;

export type DocumintListMarkerPaintFrame =
  | {
      checked: boolean;
      kind: "task";
      rect: LayoutRect;
    }
  | {
      kind: "ordered";
      label: string;
      rect: LayoutRect;
    }
  | {
      kind: "unordered";
      rect: LayoutRect;
    };

export type ListItemInsertedEffectContext = EffectContext<{
  marker: DocumintListMarkerPaintFrame;
  progress: number;
}>;

export type TextDeletedEffectContext = EffectContext<{
  color: string;
  contentKind: "code" | "text";
  font: string;
  left: number;
  progress: number;
  text: string;
  textBaseline: number;
}>;

export type TextInsertedEffectContext = EffectContext<{
  anchor: {
    x: number;
    y: number;
  };
  contentKind: "code" | "text";
  progress: number;
  text: string;
}>;

export type DocumintEffects = {
  activeBlockChanged?: DocumintEffectHandler<ActiveBlockChangedEffectContext>;
  listItemInserted?: DocumintEffectHandler<ListItemInsertedEffectContext>;
  textDeleted?: DocumintEffectHandler<TextDeletedEffectContext>;
  textInserted?: DocumintEffectHandler<TextInsertedEffectContext>;
};

// --- Renderer effects and frames ---

export type DocumentChangeEffect = {
  changeKey: string;
  kind: "document-change";
};

export type RendererEffectInput = EditorEffect | DocumentChangeEffect;

export type RendererEffect = RendererEffectInput & {
  startedAt: number;
};

export type EffectFrame<TKind extends keyof DocumintEffects> = {
  customEffectName: TKind;
  defaultEnabled: boolean;
};

type BlockEffectFrame<TKind extends keyof DocumintEffects> = EffectFrame<TKind> & {
  blockPath: string;
  progress: number;
};

export type BlockFlashFrame = BlockEffectFrame<"activeBlockChanged">;

export type BlockPulseFrame = BlockEffectFrame<"listItemInserted">;

export type DocumentChangeFadeFrame = {
  progress: number;
};

type TextEffectFrame<TKind extends keyof DocumintEffects> = EffectFrame<TKind> & {
  contentKind: "code" | "text";
  progress: number;
  path: string;
  startOffset: number;
  text: string;
};

export type TextFadeFrame = TextEffectFrame<"textDeleted">;

// Insertions paint as highlights, or as pulses for punctuation.
export type TextInsertionFrame = TextEffectFrame<"textInserted"> & {
  endOffset: number;
};
