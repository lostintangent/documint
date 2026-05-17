import type { EditorStateAction } from "../../../types";
import type { BlockContext } from "../../context";
import {
  resolveBlockquoteTextBlockSplit,
  resolveRootTextBlockSplit,
  resolveStructuralBlockquoteSplit,
} from "../blocks";
import { resolveListItemSplit, resolveStructuralListBlockSplit } from "../blocks/list";
import { resolveTableCellLineBreak } from "../blocks/table";

// Line-break policy. Commands should only resolve context and dispatch the
// resulting action.
export function resolveLineBreakAction(ctx: BlockContext): EditorStateAction | null {
  switch (ctx.kind) {
    case "code":
      return { kind: "splice-text", text: "\n" };

    case "tableCell":
      return resolveTableCellLineBreak(ctx);

    case "listItem":
      return (
        resolveStructuralListBlockSplit(ctx, ctx.offset) ?? resolveListItemSplit(ctx, ctx.offset)
      );

    case "blockquoteTextBlock":
      return (
        resolveStructuralBlockquoteSplit(ctx, ctx.offset) ??
        resolveBlockquoteTextBlockSplit(ctx, ctx.offset)
      );

    case "rootTextBlock":
      return resolveRootTextBlockSplit(ctx, ctx.offset);
  }
}
