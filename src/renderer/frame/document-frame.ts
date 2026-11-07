import type { EditorCommentRange, EditorPresence } from "@/editor/anchors";
import type { EditorLayoutState, LayoutRect, MetadataLayout } from "@/editor/layout";
import { findVisibleBlockRange, findVisibleLineRange } from "@/editor/layout";
import type { EditorState, NormalizedEditorSelection } from "@/editor/state";
import type { TextDecorationIndex } from "@/editor/text/decorations";
import { emptyDocumentResources, type DocumentResources } from "@/editor/resources";
import type { ResolvedEditorTheme } from "../theme";
import {
  resolveRendererEffects,
  type BlockFlashFrame,
  type RendererEffect,
  type DocumintEffects,
} from "../effects";
import { collectMany } from "../effects/kinds";
import { resolveCodeBlockSurfaces, type CodeBlockSurfaceFrame } from "./chrome/code-blocks";
import { resolveDividerRules } from "./chrome/divider-rules";
import {
  resolveBlockquoteRuleFrames,
  resolveHeadingRules,
  type BlockquoteRuleFrame,
} from "./chrome/rules";
import {
  resolveActiveTableCellGeometry,
  resolveTableCellChrome,
  type ActiveTableCellGeometryFrame,
  type BandedGeometryFrame,
  type TableCellChromeFrame,
} from "./chrome/table";
import {
  createDocumentChangeResolver,
  type DocumentChangeFrameInput,
  resolveTableCellDocumentChanges,
  type TableCellDocumentChangeFrame,
} from "./document-changes";
import { resolveDocumentFrameLine, type DocumentFrameLine } from "./line";
import { resolveSelectionPathRange } from "./line/ranges";

export function createDocumentFrame(
  editorState: EditorState,
  layoutState: EditorLayoutState,
  options: CreateDocumentFrameOptions,
): DocumentFrame {
  const { layout, paintTop } = layoutState;
  const ambientTime = options.ambientTime ?? options.now;
  const visibleLines = findVisibleLineRange(layout, paintTop, options.height);
  const visibleBlocks = findVisibleBlockRange(layout, paintTop, options.height);
  const effects = resolveRendererEffects(options.effects ?? [], options.now, options.customEffects);
  const resources = options.resources ?? emptyDocumentResources;
  const commentRangesByPath = new Map<string, EditorCommentRange[]>();

  for (const range of options.commentRanges) {
    collectMany(commentRangesByPath, range.path, range);
  }

  const textDecorations = options.textDecorations ?? null;
  const documentChanges = options.documentChanges ?? [];
  const resolveDocumentChange = createDocumentChangeResolver(
    documentChanges,
    effects.documentChangeFades,
  );
  const selectionPathRange = resolveSelectionPathRange(
    editorState.documentIndex,
    options.normalizedSelection,
  );
  const tableCells = resolveTableCellChrome({
    editorState,
    height: options.height,
    layout,
    top: paintTop,
    visibleBlocks,
  });
  const chrome: DocumentFrameChrome = {
    activeTableCellGeometry: resolveActiveTableCellGeometry({
      activeBlockPath: options.activeBlockPath,
      activePath: options.activePath,
      blockFlashes: effects.blockFlashes,
      cells: tableCells,
    }),
    codeBlockSurfaces: resolveCodeBlockSurfaces({
      activeBlockPath: options.activeBlockPath,
      blockFlashes: effects.blockFlashes,
      editorState,
      layout,
      resolveDocumentChange,
      theme: options.theme,
      visibleBlocks,
      width: options.width,
    }),
    blockquoteRules: resolveBlockquoteRuleFrames(
      layout,
      editorState,
      options.activeBlockPath,
      visibleLines.startIndex,
      visibleLines.endIndex,
    ),
    dividerRules: resolveDividerRules(
      layout,
      editorState,
      visibleBlocks.startIndex,
      visibleBlocks.endIndex,
      options.width,
    ),
    headingRules: resolveHeadingRules(
      layout,
      editorState,
      visibleLines.startIndex,
      visibleLines.endIndex,
      options.width,
    ),
    tableCells,
  };
  const lines: DocumentFrameLine[] = [];
  const tableCellDocumentChanges =
    documentChanges.length === 0
      ? []
      : resolveTableCellDocumentChanges({
          cells: tableCells,
          editorState,
          resolveDocumentChange,
          theme: options.theme,
        });
  let hasDocumentChangeHighlights =
    tableCellDocumentChanges.length > 0 ||
    chrome.codeBlockSurfaces.some((surface) => surface.documentChangeBackground !== null);

  for (let index = visibleLines.startIndex; index < visibleLines.endIndex; index += 1) {
    const line = resolveDocumentFrameLine({
      activeBlockPath: options.activeBlockPath,
      activeThreadIndex: options.activeThreadIndex,
      commentPresence: options.commentPresence ?? null,
      commentRangesByPath,
      editorState,
      effects,
      layoutState,
      line: layout.lines[index]!,
      normalizedSelection: options.normalizedSelection,
      resolveDocumentChange,
      resources,
      selectionPathRange,
      textDecorations,
      theme: options.theme,
      width: options.width,
    });

    lines.push(line);
    hasDocumentChangeHighlights ||= line.documentChangeBackground !== null;
  }

  return {
    activeBlockChangedEffect: resolveActiveBlockChangedEffectFrame(lines, chrome),
    ambientTime,
    effects: effects.rendererEffects,
    hasDocumentChangeHighlights,
    chrome,
    customEffects: options.customEffects,
    tableCellDocumentChanges,
    layer: {
      devicePixelRatio: options.devicePixelRatio,
      height: options.height,
      paintTop,
      width: options.width,
    },
    lines,
    metadata: layout.metadata,
    resources,
    theme: options.theme,
    viewport: {
      height: layoutState.viewport.height,
      left: 0,
      top: layoutState.viewport.top,
      width: layoutState.viewport.width,
    },
  };
}

type CreateDocumentFrameOptions = {
  activeBlockPath: string | null;
  activePath: string | null;
  activeThreadIndex: number | null;
  ambientTime?: number;
  commentPresence?: ReadonlyMap<number, EditorPresence>;
  commentRanges: EditorCommentRange[];
  customEffects?: DocumintEffects;
  devicePixelRatio: number;
  effects?: readonly RendererEffect[];
  documentChanges?: readonly DocumentChangeFrameInput[];
  height: number;
  normalizedSelection: NormalizedEditorSelection;
  now: number;
  resources?: DocumentResources | null;
  textDecorations?: TextDecorationIndex;
  theme: ResolvedEditorTheme;
  width: number;
};

export type DocumentFrame = {
  readonly activeBlockChangedEffect: ActiveBlockChangedEffectFrame | null;
  readonly effects: readonly RendererEffect[];
  readonly hasDocumentChangeHighlights: boolean;
  readonly ambientTime: number;
  readonly chrome: DocumentFrameChrome;
  readonly customEffects?: DocumintEffects;
  readonly tableCellDocumentChanges: readonly TableCellDocumentChangeFrame[];
  readonly layer: PaintLayerFrame;
  readonly lines: readonly DocumentFrameLine[];
  readonly metadata: MetadataLayout | null;
  readonly resources: DocumentResources;
  readonly theme: ResolvedEditorTheme;
  readonly viewport: LayoutRect;
};

export type DocumentFrameChrome = {
  readonly activeTableCellGeometry: ActiveTableCellGeometryFrame | null;
  readonly blockquoteRules: ReadonlyMap<string, BlockquoteRuleFrame>;
  readonly codeBlockSurfaces: readonly CodeBlockSurfaceFrame[];
  readonly dividerRules: readonly LayoutRect[];
  readonly headingRules: ReadonlyMap<string, LayoutRect>;
  readonly tableCells: readonly TableCellChromeFrame[];
};

export type PaintLayerFrame = {
  readonly devicePixelRatio: number;
  readonly height: number;
  readonly paintTop: number;
  readonly width: number;
};

export type ActiveBlockChangedEffectFrame = {
  readonly activeFlash: BlockFlashFrame;
  readonly geometry: BandedGeometryFrame;
};

function resolveActiveBlockChangedEffectFrame(
  lines: readonly DocumentFrameLine[],
  { activeTableCellGeometry, codeBlockSurfaces }: DocumentFrameChrome,
): ActiveBlockChangedEffectFrame | null {
  if (activeTableCellGeometry?.activeFlash) {
    return {
      activeFlash: activeTableCellGeometry.activeFlash,
      geometry: activeTableCellGeometry,
    };
  }

  for (const { activeBlockBackground } of codeBlockSurfaces) {
    if (activeBlockBackground?.activeFlash) {
      return {
        activeFlash: activeBlockBackground.activeFlash,
        geometry: { bands: [activeBlockBackground.rect], rect: activeBlockBackground.rect },
      };
    }
  }

  const bands: LayoutRect[] = [];
  let activeFlash: BlockFlashFrame | null = null;

  for (const line of lines) {
    const background = line.activeBlockBackground;

    if (!background?.activeFlash) {
      continue;
    }

    activeFlash ??= background.activeFlash;
    bands.push(background.rect);
  }

  if (!activeFlash) {
    return null;
  }

  return {
    activeFlash,
    geometry: {
      bands,
      rect: unionRects(bands),
    },
  };
}

function unionRects(rects: readonly LayoutRect[]): LayoutRect {
  let left = Infinity;
  let right = -Infinity;
  let top = Infinity;
  let bottom = -Infinity;

  for (const rect of rects) {
    left = Math.min(left, rect.left);
    right = Math.max(right, rect.left + rect.width);
    top = Math.min(top, rect.top);
    bottom = Math.max(bottom, rect.top + rect.height);
  }

  return {
    height: Math.max(0, bottom - top),
    left,
    top,
    width: Math.max(0, right - left),
  };
}
