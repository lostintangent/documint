// Code block surfaces and tints resolve from the block's bounds rather than its
// lines, so a tall block keeps its fill while any part of it is in the paint
// window, even after its first line scrolls away.

import {
  CODE_BLOCK_BACKGROUND_PADDING_Y,
  resolveBlockSurfaceLeft,
  type DocumentLayout,
  type LayoutRect,
} from "@/editor/layout";
import { resolveIndexedBlock, type EditorState } from "@/editor/state";
import type { BlockFlashFrame } from "../../effects";
import type { ResolvedEditorTheme } from "../../theme";
import type { DocumentChangeResolver } from "../document-changes";
import { resolveActiveFlash, resolveBlockTints, type BlockTintFrames } from "../line/backgrounds";

export type CodeBlockSurfaceFrame = BlockTintFrames & {
  path: string;
  rect: LayoutRect;
};

export function resolveCodeBlockSurfaces({
  activeBlockPath,
  blockFlashes,
  editorState,
  layout,
  resolveDocumentChange,
  theme,
  visibleBlocks,
  width,
}: {
  activeBlockPath: string | null;
  blockFlashes: ReadonlyMap<string, BlockFlashFrame>;
  editorState: EditorState;
  layout: DocumentLayout;
  resolveDocumentChange: DocumentChangeResolver;
  theme: ResolvedEditorTheme;
  visibleBlocks: { endIndex: number; startIndex: number };
  width: number;
}): CodeBlockSurfaceFrame[] {
  const surfaces: CodeBlockSurfaceFrame[] = [];

  for (let index = visibleBlocks.startIndex; index < visibleBlocks.endIndex; index += 1) {
    const block = layout.blocks[index]!;
    // A code block's text path is its block path.
    const bounds = block.type === "code" ? layout.pathBounds.get(block.blockPath) : undefined;

    if (!bounds) {
      continue;
    }

    const indexedBlock = resolveIndexedBlock(editorState.documentIndex, block.blockPath);
    const isActiveBlock = block.blockPath === activeBlockPath;
    const documentChange = resolveDocumentChange(editorState, indexedBlock, block.blockPath);
    const rect = resolveCodeBlockSurfaceRect(layout, editorState, block, bounds);

    surfaces.push({
      ...resolveBlockTints({
        activeFlash: isActiveBlock
          ? resolveActiveFlash(blockFlashes, indexedBlock?.path ?? null)
          : null,
        documentChange,
        isActiveBlock,
        // Tints span the full editor width, like a text block's line tints.
        rect: { ...rect, left: 0, width },
        theme,
      }),
      path: block.blockPath,
      rect,
    });
  }

  return surfaces;
}

// The surface wraps the code text, so in a list item it starts after the
// marker gutter.
function resolveCodeBlockSurfaceRect(
  layout: DocumentLayout,
  editorState: EditorState,
  block: DocumentLayout["blocks"][number],
  bounds: { bottom: number; top: number },
): LayoutRect {
  const left = resolveBlockSurfaceLeft(
    editorState.documentIndex,
    { depth: block.depth, path: block.blockPath },
    layout.options,
  );
  const right = Math.max(left, layout.width - layout.options.paddingX);

  return {
    height: bounds.bottom - bounds.top + CODE_BLOCK_BACKGROUND_PADDING_Y * 2,
    left,
    top: bounds.top - CODE_BLOCK_BACKGROUND_PADDING_Y,
    width: right - left,
  };
}
