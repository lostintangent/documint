import type { Block } from "@/document";
import {
  CODE_BLOCK_BACKGROUND_PADDING_Y,
  CODE_BLOCK_CONTENT_PADDING_X,
  type EditorLayoutState,
  type LayoutRect,
} from "@/editor/layout";
import type { BlockFlashFrame } from "../../effects";
import { resolveTableCellChromeFrame, type TableCellChromeFrame } from "../chrome/table";

const activeLineVerticalBleed = 2;

type RegionBounds = { bottom: number; left: number; right: number; top: number };

export type ActiveBlockBackgroundFrame = {
  activeFlash: BlockFlashFrame | null;
  rect: LayoutRect;
};

export type ContainerBackgroundFrame =
  | { kind: "code"; rect: LayoutRect }
  | ({ kind: "table-cell" } & TableCellChromeFrame);

export function resolveDocumentFrameLineBackgrounds({
  blockFlashes,
  activeBlockId,
  block,
  containerBounds,
  layout,
  line,
  runtimeBlockPath,
  tableCellPosition,
  width,
}: {
  blockFlashes: Map<string, BlockFlashFrame>;
  activeBlockId: string | null;
  block: Block | null;
  containerBounds: RegionBounds | null;
  layout: EditorLayoutState["layout"];
  line: EditorLayoutState["layout"]["lines"][number];
  runtimeBlockPath: string | null;
  tableCellPosition: { cellIndex: number; rowIndex: number } | null;
  width: number;
}): {
  activeBlockBackground: ActiveBlockBackgroundFrame | null;
  containerBackground: ContainerBackgroundFrame | null;
} {
  const codeBlockBackgroundRect =
    block?.type === "code" && line.start === 0 && containerBounds
      ? resolveCodeBlockBackgroundFrame(layout, line, containerBounds)
      : null;

  return {
    activeBlockBackground: resolveActiveBlockBackgroundFrame({
      blockFlashes,
      activeBlockId,
      block,
      codeBlockBackgroundRect,
      containerBounds,
      line,
      runtimeBlockPath,
      width,
    }),
    containerBackground: resolveContainerBackgroundFrame({
      block,
      codeBlockBackgroundRect,
      containerBounds,
      line,
      tableCellPosition,
    }),
  };
}

function resolveCodeBlockBackgroundFrame(
  layout: EditorLayoutState["layout"],
  line: EditorLayoutState["layout"]["lines"][number],
  containerBounds: RegionBounds,
): LayoutRect {
  const left = Math.max(0, line.left - CODE_BLOCK_CONTENT_PADDING_X);
  const right = Math.max(left, layout.width - layout.options.paddingX);

  return {
    height:
      containerBounds.bottom - containerBounds.top + CODE_BLOCK_BACKGROUND_PADDING_Y * 2,
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
  containerBounds: RegionBounds | null;
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
  activeBlockId,
  block,
  codeBlockBackgroundRect,
  containerBounds,
  line,
  runtimeBlockPath,
  width,
}: {
  blockFlashes: Map<string, BlockFlashFrame>;
  activeBlockId: string | null;
  block: Block | null;
  codeBlockBackgroundRect: LayoutRect | null;
  containerBounds: RegionBounds | null;
  line: EditorLayoutState["layout"]["lines"][number];
  runtimeBlockPath: string | null;
  width: number;
}): ActiveBlockBackgroundFrame | null {
  if (line.blockId !== activeBlockId) {
    return null;
  }

  const rect = resolveActiveBlockBackgroundRect(
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
    rect,
  };
}

function resolveActiveBlockBackgroundRect(
  block: Block | null,
  line: EditorLayoutState["layout"]["lines"][number],
  containerBounds: RegionBounds | null,
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
