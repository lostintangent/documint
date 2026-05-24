import { createCodeBlock, createParagraphTextBlock } from "@/document";
import type { EditorStateAction } from "../../../types";
import { createRootPrimaryRegionTarget } from "../../../selection";
import type { BlockContext, CodeBlockContext } from "../../context";
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
      return resolveCodeBlockLineBreak(ctx);

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

function resolveCodeBlockLineBreak(ctx: CodeBlockContext): EditorStateAction {
  const block = ctx.region.block;

  // Blank lines are source content, so code blocks require two trailing
  // blank lines before Enter exits and trims the exit marker.
  if (block.type !== "code" || !ctx.atEnd || !ctx.region.text.endsWith("\n\n")) {
    return { kind: "splice-text", text: "\n" };
  }

  return {
    kind: "splice-blocks",
    blocks: [
      createCodeBlock({
        language: block.language,
        meta: block.meta,
        source: ctx.region.text.replace(/\n+$/, ""),
      }),
      createParagraphTextBlock(""),
    ],
    rootIndex: ctx.rootIndex,
    selection: createRootPrimaryRegionTarget(ctx.rootIndex + 1),
  };
}
