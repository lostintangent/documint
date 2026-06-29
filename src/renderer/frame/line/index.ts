import type { EditorCommentRange, EditorPresence } from "@/editor/anchors";
import type { EditorLayoutState, LayoutRect } from "@/editor/layout";
import {
  resolveIndexedBlock,
  resolveRegion,
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
import type { SelectionRegionOrderRange } from "../selection-frame";

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
  commentRangesByRegion: ReadonlyMap<string, EditorCommentRange[]>;
  editorState: EditorState;
  layoutState: EditorLayoutState;
  line: EditorLayoutState["layout"]["lines"][number];
  normalizedSelection: NormalizedEditorSelection;
  resources: DocumentResources;
  resolveDocumentChange: DocumentChangeResolver;
  selectionRegionOrderRange: SelectionRegionOrderRange | null;
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
  commentRangesByRegion,
  editorState,
  layoutState,
  line,
  normalizedSelection,
  resources,
  resolveDocumentChange,
  selectionRegionOrderRange,
  textDecorations,
  theme,
  listMarkerPlans,
  width,
}: ResolveDocumentFrameLineOptions): DocumentFrameLine {
  const indexedBlock = resolveIndexedBlock(editorState.documentIndex, line.blockPath);
  const block = indexedBlock?.block ?? null;
  const runtimeBlockPath = indexedBlock?.path ?? null;
  const container = resolveRegion(editorState.documentIndex, line.regionPath);
  const documentChange =
    block?.type === "table"
      ? null
      : resolveDocumentChange(editorState, indexedBlock, line.regionPath);
  const containerBounds = layoutState.layout.regionBounds.get(line.regionPath) ?? null;
  const text = resolveDocumentFrameLineText({
    textFades,
    textHighlights,
    textPulses,
    block,
    container,
    layout: layoutState.layout,
    line,
    resources,
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
      tableCellPosition: container?.tableCellPosition ?? null,
      theme,
      width,
    }),
    ...resolveDocumentFrameLineRanges({
      activeThreadIndex,
      commentPresence,
      commentRanges: commentRangesByRegion.get(line.regionPath) ?? null,
      line,
      normalizedSelection,
      regionOrder: container?.regionArrayIndex ?? null,
      selectionRegionOrderRange,
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
