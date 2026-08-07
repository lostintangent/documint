import type { Block } from "@/document";
import {
  CODE_BLOCK_BACKGROUND_PADDING_Y,
  CODE_BLOCK_CONTENT_PADDING_X,
  type EditorLayoutState,
  type LayoutRect,
} from "@/editor/layout";
import type { BlockFlashFrame } from "../../effects";
import type { ResolvedEditorTheme } from "@/types";
import { resolveTableCellChromeFrame, type TableCellChromeFrame } from "../chrome/table";
import {
  resolveDocumentChangeBackgroundColor,
  resolveDocumentChangeOpacity,
  type DocumentChangeFrameEntry,
} from "../document-changes";

const activeLineVerticalBleed = 2;

type PathBounds = { bottom: number; left: number; right: number; top: number };

export type ActiveBlockBackgroundFrame = {
  activeFlash: BlockFlashFrame | null;
  color: string;
  rect: LayoutRect;
};

export type DocumentChangeBackgroundFrame = {
  color: string;
  opacity: ReturnType<typeof resolveDocumentChangeOpacity>;
  rect: LayoutRect;
};

export type ContainerBackgroundFrame =
  | { kind: "code"; rect: LayoutRect }
  | ({ kind: "table-cell" } & TableCellChromeFrame);

export function resolveDocumentFrameLineBackgrounds({
  blockFlashes,
  activeBlockPath,
  block,
  containerBounds,
  documentChange,
  layout,
  line,
  runtimeBlockPath,
  tableCellPosition,
  theme,
  width,
}: {
  blockFlashes: Map<string, BlockFlashFrame>;
  activeBlockPath: string | null;
  block: Block | null;
  containerBounds: PathBounds | null;
  documentChange: DocumentChangeFrameEntry | null;
  layout: EditorLayoutState["layout"];
  line: EditorLayoutState["layout"]["lines"][number];
  runtimeBlockPath: string | null;
  tableCellPosition: { cellIndex: number; rowIndex: number } | null;
  theme: ResolvedEditorTheme;
  width: number;
}): {
  activeBlockBackground: ActiveBlockBackgroundFrame | null;
  containerBackground: ContainerBackgroundFrame | null;
  documentChangeBackground: DocumentChangeBackgroundFrame | null;
} {
  const codeBlockBackgroundRect =
    block?.type === "code" && line.start === 0 && containerBounds
      ? resolveCodeBlockBackgroundFrame(layout, line, containerBounds)
      : null;

  return {
    activeBlockBackground: resolveActiveBlockBackgroundFrame({
      blockFlashes,
      activeBlockPath,
      block,
      codeBlockBackgroundRect,
      containerBounds,
      line,
      runtimeBlockPath,
      theme,
      width,
    }),
    containerBackground: resolveContainerBackgroundFrame({
      block,
      codeBlockBackgroundRect,
      containerBounds,
      line,
      tableCellPosition,
    }),
    documentChangeBackground: resolveDocumentChangeBackgroundFrame({
      block,
      codeBlockBackgroundRect,
      containerBounds,
      documentChange,
      line,
      theme,
      width,
    }),
  };
}

function resolveCodeBlockBackgroundFrame(
  layout: EditorLayoutState["layout"],
  line: EditorLayoutState["layout"]["lines"][number],
  containerBounds: PathBounds,
): LayoutRect {
  const left = Math.max(0, line.left - CODE_BLOCK_CONTENT_PADDING_X);
  const right = Math.max(left, layout.width - layout.options.paddingX);

  return {
    height: containerBounds.bottom - containerBounds.top + CODE_BLOCK_BACKGROUND_PADDING_Y * 2,
    left,
    top: containerBounds.top - CODE_BLOCK_BACKGROUND_PADDING_Y,
    width: right - left,
  };
}

function resolveContainerBackgroundFrame({
  block,
  codeBlockBackgroundRect,
  containerBounds,
  line,
  tableCellPosition,
}: {
  block: Block | null;
  codeBlockBackgroundRect: LayoutRect | null;
  containerBounds: PathBounds | null;
  line: EditorLayoutState["layout"]["lines"][number];
  tableCellPosition: { cellIndex: number; rowIndex: number } | null;
}): ContainerBackgroundFrame | null {
  if (!containerBounds || line.start !== 0) {
    return null;
  }

  if (block?.type === "code") {
    if (!codeBlockBackgroundRect) {
      return null;
    }

    return {
      kind: "code",
      rect: codeBlockBackgroundRect,
    };
  }

  if (block?.type !== "table") {
    return null;
  }

  return {
    kind: "table-cell",
    ...resolveTableCellChromeFrame(containerBounds, {
      isHeaderRow: tableCellPosition?.rowIndex === 0,
      lineHeight: line.height,
    }),
  };
}

function resolveActiveBlockBackgroundFrame({
  blockFlashes,
  activeBlockPath,
  block,
  codeBlockBackgroundRect,
  containerBounds,
  line,
  runtimeBlockPath,
  theme,
  width,
}: {
  blockFlashes: Map<string, BlockFlashFrame>;
  activeBlockPath: string | null;
  block: Block | null;
  codeBlockBackgroundRect: LayoutRect | null;
  containerBounds: PathBounds | null;
  line: EditorLayoutState["layout"]["lines"][number];
  runtimeBlockPath: string | null;
  theme: ResolvedEditorTheme;
  width: number;
}): ActiveBlockBackgroundFrame | null {
  const isActiveBlock = line.blockPath === activeBlockPath;

  if (!isActiveBlock) {
    return null;
  }

  const rect = resolveBlockBackgroundRect(
    block,
    line,
    containerBounds,
    codeBlockBackgroundRect,
    width,
  );

  if (!rect) {
    return null;
  }

  return {
    activeFlash: runtimeBlockPath ? (blockFlashes.get(runtimeBlockPath) ?? null) : null,
    color: theme.activeBlockBackground,
    rect,
  };
}

function resolveBlockBackgroundRect(
  block: Block | null,
  line: EditorLayoutState["layout"]["lines"][number],
  containerBounds: PathBounds | null,
  codeBlockBackgroundRect: LayoutRect | null,
  width: number,
): LayoutRect | null {
  if (block?.type === "table") {
    return null;
  }

  if (block?.type === "code") {
    if (!containerBounds || line.start !== 0 || !codeBlockBackgroundRect) {
      return null;
    }

    return {
      height: containerBounds.bottom - containerBounds.top,
      left: codeBlockBackgroundRect.left,
      top: containerBounds.top,
      width: codeBlockBackgroundRect.width,
    };
  }

  return {
    height: line.height,
    left: 0,
    top: line.top - activeLineVerticalBleed,
    width,
  };
}

function resolveDocumentChangeBackgroundFrame({
  block,
  codeBlockBackgroundRect,
  containerBounds,
  documentChange,
  line,
  theme,
  width,
}: {
  block: Block | null;
  codeBlockBackgroundRect: LayoutRect | null;
  containerBounds: PathBounds | null;
  documentChange: DocumentChangeFrameEntry | null;
  line: EditorLayoutState["layout"]["lines"][number];
  theme: ResolvedEditorTheme;
  width: number;
}): DocumentChangeBackgroundFrame | null {
  if (!documentChange) {
    return null;
  }

  const rect = resolveBlockBackgroundRect(
    block,
    line,
    containerBounds,
    codeBlockBackgroundRect,
    width,
  );

  if (!rect) {
    return null;
  }

  return {
    color: resolveDocumentChangeBackgroundColor(documentChange, theme),
    opacity: resolveDocumentChangeOpacity(documentChange),
    rect,
  };
}
