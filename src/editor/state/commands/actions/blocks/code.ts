// Code block action policy. Code blocks mostly edit as source text, except
// Enter at the trailing blank-line exit marker, which commits a trimmed code
// block and lands the caret in a following paragraph.

import { createCodeBlock, createParagraphTextBlock } from "@/document";
import { target } from "../../../selection";
import type { EditorStateAction } from "../../../types";
import type { CodeBlockContext, RootBlockInsertionContext } from "../../context";

export function resolveCodeBlockInsertion(context: RootBlockInsertionContext): EditorStateAction {
  const codeBlock = createCodeBlock({ source: "" });

  return {
    kind: "splice-blocks",
    blocks: [codeBlock],
    rootIndex: context.rootIndex,
    selection: target.block(codeBlock),
  };
}

export function resolveCodeBlockLineBreak(ctx: CodeBlockContext): EditorStateAction {
  if (!shouldExitCodeBlock(ctx)) {
    return insertCodeBlockSourceLineBreak();
  }

  return exitCodeBlock(ctx);
}

// Blank lines are source content, so code blocks require two trailing blank
// lines before Enter exits and trims the exit marker.
function shouldExitCodeBlock(ctx: CodeBlockContext): boolean {
  return ctx.atEnd && ctx.text.endsWith("\n\n");
}

function insertCodeBlockSourceLineBreak(): EditorStateAction {
  return { kind: "splice-text", text: "\n" };
}

function exitCodeBlock(ctx: CodeBlockContext): EditorStateAction {
  const exitParagraph = createParagraphTextBlock("");

  return {
    kind: "splice-blocks",
    blocks: [
      createCodeBlock({
        language: ctx.block.language,
        meta: ctx.block.meta,
        source: ctx.text.replace(/\n+$/, ""),
      }),
      exitParagraph,
    ],
    rootIndex: ctx.rootIndex,
    selection: target.block(exitParagraph),
  };
}
