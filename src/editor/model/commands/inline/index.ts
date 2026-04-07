// Inline command boundary for semantic mark and inline-code edits within a
// single editable region.
import type { Block } from "@/document";
import {
  type EditorSelectionTarget,
  resolveInlineCommandTarget,
  type CanvasSelection,
} from "../../document-editor";
import type { EditorState } from "../../state";

export { toggleSelectionInlineCodeOperation } from "./code";
export { toggleSelectionMarkOperation } from "./marks";

export type InlineCommandHelpers = {
  applyBlockReplacement: (
    state: EditorState,
    targetBlockId: string,
    replacement: Block,
    selection?: CanvasSelection | EditorSelectionTarget,
  ) => EditorState | null;
  findBlockById: (blocks: Block[], blockId: string) => Block | null;
  normalizeSelection: typeof import("../../document-editor").normalizeCanvasSelection;
};

export function applyInlineSelectionOperation(
  state: EditorState,
  helpers: InlineCommandHelpers,
  applyTargetEdit: (
    target: NonNullable<ReturnType<typeof resolveInlineCommandTarget>>,
    startOffset: number,
    endOffset: number,
  ) => {
    block: Block;
    blockId: string;
    selection: CanvasSelection | EditorSelectionTarget;
  } | null,
) {
  const selection = helpers.normalizeSelection(state.documentEditor, state.selection);

  if (
    selection.start.regionId !== selection.end.regionId ||
    selection.start.offset === selection.end.offset
  ) {
    return null;
  }

  const region = state.documentEditor.regionIndex.get(selection.start.regionId);

  if (!region) {
    return null;
  }

  const block = helpers.findBlockById(state.documentEditor.document.blocks, region.blockId);

  if (!block) {
    return null;
  }

  const target = resolveInlineCommandTarget(block, region.path, region.semanticRegionId);

  if (!target) {
    return null;
  }

  const replacement = applyTargetEdit(
    target,
    selection.start.offset,
    selection.end.offset,
  );

  return replacement
    ? helpers.applyBlockReplacement(state, replacement.blockId, replacement.block, replacement.selection)
    : null;
}
