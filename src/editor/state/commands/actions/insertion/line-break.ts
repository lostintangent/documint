import type { EditorStateAction } from "../../../types";
import type { BlockContext } from "../../context";
import {
  resolveBlockquoteTextBlockSplit,
  resolveRootTextBlockSplit,
  resolveStructuralBlockquoteSplit,
} from "../blocks";
import { resolveCodeBlockLineBreak } from "../blocks/code";
import { resolveListItemLineBreak } from "../blocks/list";
import { resolveTableCellLineBreak } from "../blocks/table";

// Enter-key action policy.
//
// Context resolution happens in the command layer; this file only chooses the
// block-specific line-break behavior:
//   - tables, lists, code blocks, blockquotes, and root text blocks delegate
//     to their block action files, where the structural rebuild policy lives.
export function resolveLineBreakAction(ctx: BlockContext): EditorStateAction | null {
  switch (ctx.kind) {
    case "code":
      return resolveCodeBlockLineBreak(ctx);

    case "tableCell":
      return resolveTableCellLineBreak(ctx);

    case "listItem":
      return resolveListItemLineBreak(ctx, ctx.offset);

    case "blockquoteTextBlock":
      return (
        resolveStructuralBlockquoteSplit(ctx, ctx.offset) ??
        resolveBlockquoteTextBlockSplit(ctx, ctx.offset)
      );

    case "rootTextBlock":
      return resolveRootTextBlockSplit(ctx, ctx.offset);
  }
}
