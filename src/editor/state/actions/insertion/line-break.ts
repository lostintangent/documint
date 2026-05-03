import type { DocumentIndex } from "../../index/types";
import type { EditorSelection } from "../../selection";
import type { EditorStateAction } from "../../types";
import type { BlockCommandContext } from "../../context";
import { resolveBlockquoteTextBlockSplit, resolveRootTextBlockSplit, resolveStructuralBlockquoteSplit } from "../blocks";
import { resolveListItemSplit, resolveStructuralListBlockSplit } from "../blocks/list";
import { resolveTableCellLineBreak } from "../blocks/table";

// Line-break policy. Commands should only resolve context, dispatch the
// resulting action, and apply presentation concerns like list-marker
// animations.
export function resolveLineBreakAction(
  documentIndex: DocumentIndex,
  selection: EditorSelection,
  ctx: BlockCommandContext,
): EditorStateAction | null {
  switch (ctx.kind) {
    case "code":
      return { kind: "splice-text", selection, text: "\n" };

    case "tableCell":
      return resolveTableCellLineBreak(documentIndex, selection);

    case "listItem":
      return resolveStructuralListBlockSplit(ctx, ctx.offset) ?? resolveListItemSplit(ctx, ctx.offset);

    case "blockquoteTextBlock":
      return (
        resolveStructuralBlockquoteSplit(ctx, ctx.offset) ??
        resolveBlockquoteTextBlockSplit(ctx, ctx.offset)
      );

    case "rootTextBlock":
      return resolveRootTextBlockSplit(ctx, ctx.offset);

    case "unsupported":
      return null;
  }
}
