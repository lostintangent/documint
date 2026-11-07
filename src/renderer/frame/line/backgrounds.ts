// Owns active-block and document-change tints. Text blocks tint each line
// band, while code blocks and table cells tint from their extents in frame
// chrome so a tint never depends on which of their lines are in the window.

import type { Block } from "@/document";
import type { EditorLayoutState, LayoutRect } from "@/editor/layout";
import type { BlockFlashFrame } from "../../effects";
import type { ResolvedEditorTheme } from "../../theme";
import {
  resolveDocumentChangeBackgroundColor,
  resolveDocumentChangeOpacity,
  type DocumentChangeFrameEntry,
} from "../document-changes";

const activeLineVerticalBleed = 2;

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

export type BlockTintFrames = {
  activeBlockBackground: ActiveBlockBackgroundFrame | null;
  documentChangeBackground: DocumentChangeBackgroundFrame | null;
};

export const noBlockTints: BlockTintFrames = {
  activeBlockBackground: null,
  documentChangeBackground: null,
};

// Code blocks and table cells tint from their extents in frame chrome instead.
export function hasLineBlockTints(block: Block | null) {
  return block?.type !== "code" && block?.type !== "table";
}

export function resolveDocumentFrameLineBackgrounds({
  activeBlockPath,
  blockFlashes,
  documentChange,
  line,
  runtimeBlockPath,
  theme,
  width,
}: {
  activeBlockPath: string | null;
  blockFlashes: ReadonlyMap<string, BlockFlashFrame>;
  documentChange: DocumentChangeFrameEntry | null;
  line: EditorLayoutState["layout"]["lines"][number];
  runtimeBlockPath: string | null;
  theme: ResolvedEditorTheme;
  width: number;
}): BlockTintFrames {
  const isActiveBlock = line.blockPath !== null && line.blockPath === activeBlockPath;

  if (!isActiveBlock && !documentChange) {
    return noBlockTints;
  }

  return resolveBlockTints({
    activeFlash: isActiveBlock ? resolveActiveFlash(blockFlashes, runtimeBlockPath) : null,
    documentChange,
    isActiveBlock,
    rect: { height: line.height, left: 0, top: line.top - activeLineVerticalBleed, width },
    theme,
  });
}

export function resolveBlockTints({
  activeFlash,
  documentChange,
  isActiveBlock,
  rect,
  theme,
}: {
  activeFlash: BlockFlashFrame | null;
  documentChange: DocumentChangeFrameEntry | null;
  isActiveBlock: boolean;
  rect: LayoutRect;
  theme: ResolvedEditorTheme;
}): BlockTintFrames {
  return {
    activeBlockBackground: isActiveBlock
      ? { activeFlash, color: theme.activeBlockBackground, rect }
      : null,
    documentChangeBackground: documentChange
      ? {
          color: resolveDocumentChangeBackgroundColor(documentChange, theme),
          opacity: resolveDocumentChangeOpacity(documentChange),
          rect,
        }
      : null,
  };
}

export function resolveActiveFlash(
  blockFlashes: ReadonlyMap<string, BlockFlashFrame>,
  runtimeBlockPath: string | null,
) {
  return runtimeBlockPath ? (blockFlashes.get(runtimeBlockPath) ?? null) : null;
}
