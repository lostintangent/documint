import type { DocumentResources, ResolvedEditorTheme } from "@/types";

export type TextPaintContext = {
  ambientAnimationTime: number;
  baseFontSize: number;
  resources: DocumentResources;
  theme: ResolvedEditorTheme;
};
