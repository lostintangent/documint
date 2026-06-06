import type { Block } from "@/document";
import type { EditorLayoutState } from "@/editor/layout";
import type { EditableRegion } from "@/editor/state";
import type { TextDecoration, TextDecorationIndex } from "@/editor/text/decorations";
import { resolveCenteredTextBaseline } from "@/editor/text/measure";
import type { DocumentResources, ResolvedEditorTheme } from "@/types";
import type { ActiveTextFade, ActiveTextHighlight, ActiveTextPulse } from "../../animations";
import { resolveLineTextSegments, type TextSegment } from "./text-segments";

export type DocumentFrameLineText = {
  readonly activeTextFades: readonly ActiveTextFade[];
  readonly activeTextHighlights: readonly ActiveTextHighlight[];
  readonly activeTextPulses: readonly ActiveTextPulse[];
  readonly defaultTextColor: string;
  readonly segments: readonly TextSegment[];
  readonly textBaseline: number;
  readonly textDecorations: readonly TextDecoration[] | null;
  readonly textLeft: number;
};

export function resolveDocumentFrameLineText({
  activeTextFades,
  activeTextHighlights,
  activeTextPulses,
  block,
  container,
  layout,
  line,
  resources,
  textDecorations,
  theme,
}: {
  activeTextFades: Map<string, ActiveTextFade[]>;
  activeTextHighlights: Map<string, ActiveTextHighlight[]>;
  activeTextPulses: Map<string, ActiveTextPulse[]>;
  block: Block | null;
  container: EditableRegion | null;
  layout: EditorLayoutState["layout"];
  line: EditorLayoutState["layout"]["lines"][number];
  resources: DocumentResources;
  textDecorations: TextDecorationIndex;
  theme: ResolvedEditorTheme;
}): DocumentFrameLineText {
  const containerPath = container?.path ?? "";
  const activeTextFadesForLine = container ? (activeTextFades.get(containerPath) ?? []) : [];
  const activeTextHighlightsForLine = container
    ? (activeTextHighlights.get(containerPath) ?? [])
    : [];
  const activeTextPulsesForLine = container ? (activeTextPulses.get(containerPath) ?? []) : [];
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
    activeTextFades: activeTextFadesForLine,
    activeTextHighlights: activeTextHighlightsForLine,
    activeTextPulses: activeTextPulsesForLine,
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
