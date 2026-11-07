import type { EditorCommentRange, EditorPresence } from "@/editor/anchors";
import { resolveListMarkerTarget, type EditorLayoutState } from "@/editor/layout";
import {
  resolveIndexedBlock,
  resolveIndexedText,
  resolveIndexedTextInlines,
  type EditorState,
  type NormalizedEditorSelection,
} from "@/editor/state";
import type { TextDecorationIndex } from "@/editor/text/decorations";
import type { DocumentResources } from "@/editor/resources";
import type { ResolvedEditorTheme } from "../../theme";
import type { BlockPulseFrame } from "../../effects";
import type { EffectGroups } from "../../effects/kinds";
import {
  hasLineBlockTints,
  noBlockTints,
  resolveDocumentFrameLineBackgrounds,
  type ActiveBlockBackgroundFrame,
  type DocumentChangeBackgroundFrame,
} from "./backgrounds";
import {
  resolveCommentHighlightFrames,
  resolveSelectionHighlightFrame,
  type CommentHighlightFrame,
  type SelectionHighlightFrame,
  type SelectionPathRange,
} from "./ranges";
import type { DocumentFrameLineText } from "./text";
import { resolveDocumentFrameLineText } from "./text";
import { resolveListMarkerFrame, type ListMarkerFrame } from "../chrome/list-markers";
import type { DocumentChangeResolver } from "../document-changes";

export type DocumentFrameLine = DocumentFrameLineText & {
  readonly activeBlockBackground: ActiveBlockBackgroundFrame | null;
  readonly blockPulse: BlockPulseFrame | null;
  readonly documentChangeBackground: DocumentChangeBackgroundFrame | null;
  readonly commentHighlights: readonly CommentHighlightFrame[];
  readonly layoutLine: EditorLayoutState["layout"]["lines"][number];
  readonly listMarker: ListMarkerFrame | null;
  readonly selectionHighlight: SelectionHighlightFrame | null;
};

type ResolveDocumentFrameLineOptions = {
  activeBlockPath: string | null;
  activeThreadIndex: number | null;
  commentPresence: ReadonlyMap<number, EditorPresence> | null;
  commentRangesByPath: ReadonlyMap<string, EditorCommentRange[]>;
  editorState: EditorState;
  effects: EffectGroups;
  layoutState: EditorLayoutState;
  line: EditorLayoutState["layout"]["lines"][number];
  normalizedSelection: NormalizedEditorSelection;
  resources: DocumentResources;
  resolveDocumentChange: DocumentChangeResolver;
  selectionPathRange: SelectionPathRange | null;
  textDecorations: TextDecorationIndex | null;
  theme: ResolvedEditorTheme;
  width: number;
};

export function resolveDocumentFrameLine({
  activeBlockPath,
  activeThreadIndex,
  commentPresence,
  commentRangesByPath,
  editorState,
  effects,
  layoutState,
  line,
  normalizedSelection,
  resources,
  resolveDocumentChange,
  selectionPathRange,
  textDecorations,
  theme,
  width,
}: ResolveDocumentFrameLineOptions): DocumentFrameLine {
  const indexedBlock =
    line.blockPath === null ? null : resolveIndexedBlock(editorState.documentIndex, line.blockPath);
  const block = indexedBlock?.block ?? null;
  const runtimeBlockPath = indexedBlock?.path ?? null;
  const indexedText = resolveIndexedText(editorState.documentIndex, line.path);
  // The target resolves only on a list item's first visual line, which carries its marker and pulse.
  const listMarkerTarget = resolveListMarkerTarget(editorState, line, layoutState.layout.options);
  const text = resolveDocumentFrameLineText({
    block,
    effects,
    inlines: indexedText ? resolveIndexedTextInlines(indexedText) : null,
    layout: layoutState.layout,
    line,
    resources,
    text: indexedText?.text ?? null,
    textDecorations,
    theme,
  });

  return {
    ...text,
    ...(hasLineBlockTints(block)
      ? resolveDocumentFrameLineBackgrounds({
          activeBlockPath,
          blockFlashes: effects.blockFlashes,
          documentChange: resolveDocumentChange(editorState, indexedBlock, line.path),
          line,
          runtimeBlockPath,
          theme,
          width,
        })
      : noBlockTints),
    blockPulse: listMarkerTarget
      ? (effects.blockPulses.get(listMarkerTarget.listItemPath) ?? null)
      : null,
    commentHighlights: resolveCommentHighlightFrames({
      activeThreadIndex,
      commentPresence,
      commentRanges: commentRangesByPath.get(line.path) ?? null,
      line,
      theme,
    }),
    layoutLine: line,
    listMarker: resolveListMarkerFrame(listMarkerTarget, line, text.textBaseline),
    selectionHighlight: resolveSelectionHighlightFrame({
      block,
      documentIndex: editorState.documentIndex,
      line,
      normalizedSelection,
      selectionPathRange,
    }),
  };
}
