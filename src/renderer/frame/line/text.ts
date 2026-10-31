import type { Block } from "@/document";
import type { EditorLayoutState } from "@/editor/layout";
import type { IndexedInline } from "@/editor/state";
import type { TextDecoration, TextDecorationIndex } from "@/editor/text/decorations";
import { resolveCenteredTextBaseline } from "@/editor/text/measure";
import type { DocumentResources } from "@/editor/resources";
import type { ResolvedEditorTheme } from "../../theme";
import type { TextFadeFrame, TextInsertionFrame } from "../../effects";
import { resolveLineTextSegments, type TextSegment } from "./text-segments";

export type DocumentFrameLineText = {
  readonly textFades: readonly TextFadeFrame[];
  readonly textHighlights: readonly TextInsertionFrame[];
  readonly textPulses: readonly TextInsertionFrame[];
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
  inlines,
  layout,
  line,
  resources,
  text,
  textDecorations,
  theme,
}: {
  textFades: Map<string, TextFadeFrame[]>;
  textHighlights: Map<string, TextInsertionFrame[]>;
  textPulses: Map<string, TextInsertionFrame[]>;
  block: Block | null;
  inlines: readonly IndexedInline[] | null;
  layout: EditorLayoutState["layout"];
  line: EditorLayoutState["layout"]["lines"][number];
  resources: DocumentResources;
  text: string | null;
  textDecorations: TextDecorationIndex | null;
  theme: ResolvedEditorTheme;
}): DocumentFrameLineText {
  const textFadesForLine = text !== null ? (textFades.get(line.path) ?? []) : [];
  const textHighlightsForLine = text !== null ? (textHighlights.get(line.path) ?? []) : [];
  const textPulsesForLine = text !== null ? (textPulses.get(line.path) ?? []) : [];
  const textDecorationsForLine = text !== null ? (textDecorations?.get(line.path) ?? null) : null;
  const textLeft = line.left + line.contentInset;
  const textBaseline = line.top + resolveCenteredTextBaseline(line.height, line.font);
  const defaultTextColor =
    block?.type === "code" ? theme.codeText : resolveTextColor(block, line, theme);
  const segments = resolveLineTextSegments({
    baseFontSize: layout.options.fontSize,
    defaultTextColor,
    inlines,
    line,
    resources,
    text,
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

function resolveTextColor(
  block: Block | null,
  line: EditorLayoutState["layout"]["lines"][number],
  theme: ResolvedEditorTheme,
) {
  if (line.blockPath === null) {
    return theme.headingText;
  }

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
