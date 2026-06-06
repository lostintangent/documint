import type { EditorCommentRange, EditorPresence } from "@/editor/anchors";
import type { EditorLayoutState, LayoutRect } from "@/editor/layout";
import {
  resolveIndexedBlock,
  type EditorState,
  type NormalizedEditorSelection,
} from "@/editor/state";
import type { TextDecorationIndex } from "@/editor/text/decorations";
import type { DocumentResources, ResolvedEditorTheme } from "@/types";
import type {
  ActiveBlockFlash,
  ActiveBlockPulse,
  ActiveTextFade,
  ActiveTextHighlight,
  ActiveTextPulse,
} from "../../animations";
import type { ActiveBlockBackgroundFrame, ContainerBackgroundFrame } from "./backgrounds";
import { resolveDocumentFrameLineBackgrounds } from "./backgrounds";
import { resolveDocumentFrameLineList } from "./list";
import type { CommentHighlightFrame } from "./ranges";
import { resolveDocumentFrameLineRanges } from "./ranges";
import type { DocumentFrameLineText } from "./text";
import { resolveDocumentFrameLineText } from "./text";
import type { ListMarkerFrame, ListMarkerPlan } from "../chrome/list-markers";
import type { SelectionRegionOrderRange } from "../selection-frame";

export type DocumentFrameLine = DocumentFrameLineText & {
  readonly activeBlockBackground: ActiveBlockBackgroundFrame | null;
  readonly blockPulse: ActiveBlockPulse | null;
  readonly containerBackground: ContainerBackgroundFrame | null;
  readonly commentHighlights: readonly CommentHighlightFrame[];
  readonly layoutLine: EditorLayoutState["layout"]["lines"][number];
  readonly listMarker: ListMarkerFrame | null;
  readonly selectionHighlight: LayoutRect | null;
};

type ResolveDocumentFrameLineOptions = {
  activeBlockFlashes: Map<string, ActiveBlockFlash>;
  activeBlockId: string | null;
  activeBlockPulses: Map<string, ActiveBlockPulse>;
  activeTextFades: Map<string, ActiveTextFade[]>;
  activeTextHighlights: Map<string, ActiveTextHighlight[]>;
  activeTextPulses: Map<string, ActiveTextPulse[]>;
  activeThreadIndex: number | null;
  commentPresence: ReadonlyMap<number, EditorPresence>;
  commentRangesByRegion: ReadonlyMap<string, EditorCommentRange[]>;
  editorState: EditorState;
  layoutState: EditorLayoutState;
  line: EditorLayoutState["layout"]["lines"][number];
  normalizedSelection: NormalizedEditorSelection;
  resources: DocumentResources;
  selectionRegionOrderRange: SelectionRegionOrderRange | null;
  textDecorations: TextDecorationIndex;
  theme: ResolvedEditorTheme;
  listMarkerPlans: Map<string, ListMarkerPlan>;
  width: number;
};

export function resolveDocumentFrameLine({
  activeBlockFlashes,
  activeBlockId,
  activeBlockPulses,
  activeTextFades,
  activeTextHighlights,
  activeTextPulses,
  activeThreadIndex,
  commentPresence,
  commentRangesByRegion,
  editorState,
  layoutState,
  line,
  normalizedSelection,
  resources,
  selectionRegionOrderRange,
  textDecorations,
  theme,
  listMarkerPlans,
  width,
}: ResolveDocumentFrameLineOptions): DocumentFrameLine {
  const indexedBlock = resolveIndexedBlock(editorState.documentIndex, line.blockId);
  const block = indexedBlock?.block ?? null;
  const runtimeBlockPath = indexedBlock?.path ?? null;
  const container = editorState.documentIndex.regionIndex.get(line.regionId) ?? null;
  const containerBounds = layoutState.layout.regionBounds.get(line.regionId) ?? null;
  const text = resolveDocumentFrameLineText({
    activeTextFades,
    activeTextHighlights,
    activeTextPulses,
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
      activeBlockFlashes,
      activeBlockId,
      block,
      containerBounds,
      layout: layoutState.layout,
      line,
      runtimeBlockPath,
      tableCellPosition: container?.tableCellPosition ?? null,
      width,
    }),
    ...resolveDocumentFrameLineRanges({
      activeThreadIndex,
      commentPresence,
      commentRanges: commentRangesByRegion.get(line.regionId) ?? null,
      line,
      normalizedSelection,
      regionOrder: container?.documentOrder ?? null,
      selectionRegionOrderRange,
      theme,
    }),
    ...resolveDocumentFrameLineList({
      activeBlockPulses,
      line,
      textBaseline: text.textBaseline,
      textLeft: text.textLeft,
      listMarkerPlans,
    }),
    layoutLine: line,
  };
}
