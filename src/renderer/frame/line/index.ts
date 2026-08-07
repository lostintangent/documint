import type { EditorCommentRange, EditorPresence } from "@/editor/anchors";
import type { EditorLayoutState, LayoutRect } from "@/editor/layout";
import {
  resolveIndexedBlock,
  resolveIndexedText,
  resolveIndexedTextInlines,
  type EditorState,
  type NormalizedEditorSelection,
} from "@/editor/state";
import type { TextDecorationIndex } from "@/editor/text/decorations";
import type { DocumentResources, ResolvedEditorTheme } from "@/types";
import type {
  BlockFlashFrame,
  BlockPulseFrame,
  TextFadeFrame,
  TextHighlightFrame,
  TextPulseFrame,
} from "../../effects";
import type {
  ActiveBlockBackgroundFrame,
  ContainerBackgroundFrame,
  DocumentChangeBackgroundFrame,
} from "./backgrounds";
import { resolveDocumentFrameLineBackgrounds } from "./backgrounds";
import { resolveDocumentFrameLineList } from "./list";
import type { CommentHighlightFrame } from "./ranges";
import { resolveDocumentFrameLineRanges } from "./ranges";
import type { DocumentFrameLineText } from "./text";
import { resolveDocumentFrameLineText } from "./text";
import type { ListMarkerFrame, ListMarkerPlan } from "../chrome/list-markers";
import type { DocumentChangeResolver } from "../document-changes";
import type { SelectionPathRange } from "../selection-frame";

export type DocumentFrameLine = DocumentFrameLineText & {
  readonly activeBlockBackground: ActiveBlockBackgroundFrame | null;
  readonly blockPulse: BlockPulseFrame | null;
  readonly containerBackground: ContainerBackgroundFrame | null;
  readonly documentChangeBackground: DocumentChangeBackgroundFrame | null;
  readonly commentHighlights: readonly CommentHighlightFrame[];
  readonly layoutLine: EditorLayoutState["layout"]["lines"][number];
  readonly listMarker: ListMarkerFrame | null;
  readonly selectionHighlight: LayoutRect | null;
};

type ResolveDocumentFrameLineOptions = {
  blockFlashes: Map<string, BlockFlashFrame>;
  activeBlockPath: string | null;
  blockPulses: Map<string, BlockPulseFrame>;
  textFades: Map<string, TextFadeFrame[]>;
  textHighlights: Map<string, TextHighlightFrame[]>;
  textPulses: Map<string, TextPulseFrame[]>;
  activeThreadIndex: number | null;
  commentPresence: ReadonlyMap<number, EditorPresence> | null;
  commentRangesByPath: ReadonlyMap<string, EditorCommentRange[]>;
  editorState: EditorState;
  layoutState: EditorLayoutState;
  line: EditorLayoutState["layout"]["lines"][number];
  normalizedSelection: NormalizedEditorSelection;
  resources: DocumentResources;
  resolveDocumentChange: DocumentChangeResolver;
  selectionPathRange: SelectionPathRange | null;
  textDecorations: TextDecorationIndex | null;
  theme: ResolvedEditorTheme;
  listMarkerPlans: Map<string, ListMarkerPlan>;
  width: number;
};

export function resolveDocumentFrameLine({
  blockFlashes,
  activeBlockPath,
  blockPulses,
  textFades,
  textHighlights,
  textPulses,
  activeThreadIndex,
  commentPresence,
  commentRangesByPath,
  editorState,
  layoutState,
  line,
  normalizedSelection,
  resources,
  resolveDocumentChange,
  selectionPathRange,
  textDecorations,
  theme,
  listMarkerPlans,
  width,
}: ResolveDocumentFrameLineOptions): DocumentFrameLine {
  const indexedBlock = resolveIndexedBlock(editorState.documentIndex, line.blockPath);
  const block = indexedBlock?.block ?? null;
  const runtimeBlockPath = indexedBlock?.path ?? null;
  const indexedText = resolveIndexedText(editorState.documentIndex, line.path);
  const indexedCell = indexedText && "rowIndex" in indexedText ? indexedText : null;
  const documentChange =
    block?.type === "table" ? null : resolveDocumentChange(editorState, indexedBlock, line.path);
  const containerBounds = layoutState.layout.pathBounds.get(line.path) ?? null;
  const text = resolveDocumentFrameLineText({
    textFades,
    textHighlights,
    textPulses,
    block,
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
    ...resolveDocumentFrameLineBackgrounds({
      blockFlashes,
      activeBlockPath,
      block,
      containerBounds,
      documentChange,
      layout: layoutState.layout,
      line,
      runtimeBlockPath,
      tableCellPosition: indexedCell
        ? { cellIndex: indexedCell.cellIndex, rowIndex: indexedCell.rowIndex }
        : null,
      theme,
      width,
    }),
    ...resolveDocumentFrameLineRanges({
      documentIndex: editorState.documentIndex,
      activeThreadIndex,
      commentPresence,
      commentRanges: commentRangesByPath.get(line.path) ?? null,
      line,
      normalizedSelection,
      selectionPathRange,
      theme,
    }),
    ...resolveDocumentFrameLineList({
      blockPulses,
      line,
      textBaseline: text.textBaseline,
      textLeft: text.textLeft,
      listMarkerPlans,
    }),
    layoutLine: line,
  };
}
