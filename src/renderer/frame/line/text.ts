import type { Block } from "@/document";
import type { EditorLayoutState } from "@/editor/layout";
import type { EditableRegion } from "@/editor/state";
import type { TextDecoration, TextDecorationIndex } from "@/editor/text/decorations";
import { resolveCenteredTextBaseline } from "@/editor/text/measure";
import type { DocumentResources, ResolvedEditorTheme } from "@/types";
import type { ActiveTextFade, ActiveTextHighlight, ActiveTextPulse } from "../../effects";
import { resolveLineTextSegments, type TextSegment } from "./text-segments";

export type DocumentFrameLineText = {
  readonly textFades: readonly ActiveTextFade[];
  readonly textHighlights: readonly ActiveTextHighlight[];
  readonly textPulses: readonly ActiveTextPulse[];
  readonly defaultTextColor: string;
  readonly segments: readonly TextSegment[];
  readonly textBaseline: number;
  readonly textDecorations: readonly TextDecoration[] | null;
  readonly textLeft: number;
};

export function resolveDocumentFrameLineText({
  textFades,
  textHighlights,
  textPulses,
  block,
  container,
  layout,
  line,
  resources,
  textDecorations,
  theme,
}: {
  textFades: Map<string, ActiveTextFade[]>;
  textHighlights: Map<string, ActiveTextHighlight[]>;
  textPulses: Map<string, ActiveTextPulse[]>;
  block: Block | null;
  container: EditableRegion | null;
  layout: EditorLayoutState["layout"];
  line: EditorLayoutState["layout"]["lines"][number];
  resources: DocumentResources;
  textDecorations: TextDecorationIndex;
  theme: ResolvedEditorTheme;
}): DocumentFrameLineText {
  const containerPath = container?.path ?? "";
  const textFadesForLine = container ? (textFades.get(containerPath) ?? []) : [];
  const textHighlightsForLine = container
    ? (textHighlights.get(containerPath) ?? [])
    : [];
  const textPulsesForLine = container ? (textPulses.get(containerPath) ?? []) : [];
  const textDecorationsForLine = container ? (textDecorations.get(containerPath) ?? null) : null;
  const textLeft = line.left + line.contentInset;
  const textBaseline = line.top + resolveCenteredTextBaseline(line.height, line.font);
  const defaultTextColor = block?.type === "code" ? theme.codeText : resolveTextColor(block, theme);
  const segments = resolveLineTextSegments({
    baseFontSize: layout.options.fontSize,
    container,
    defaultTextColor,
    line,
    resources,
    textBaseline,
    textLeft,
    theme,
  });

  return {
    textFades: textFadesForLine,
    textHighlights: textHighlightsForLine,
    textPulses: textPulsesForLine,
    defaultTextColor,
    segments,
    textBaseline,
    textDecorations: textDecorationsForLine,
    textLeft,
  };
}

function resolveTextColor(block: Block | null, theme: ResolvedEditorTheme) {
  switch (block?.type) {
    case "heading":
      return theme.headingText;
    case "blockquote":
      return theme.blockquoteText;
    case "table":
      return theme.headingText;
    default:
      return theme.paragraphText;
  }
}
