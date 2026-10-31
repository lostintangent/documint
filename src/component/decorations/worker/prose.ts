import { visitBlockTree, type Block } from "@/document";
import type { TextDecoration } from "@/editor";
import { inlineNodesWithEditorRanges } from "@/editor/text/inline-offsets";
import type { DocumintDecoration } from "../shared";
import { appendTextDecorations, compileDecorations } from "./matching";

// Applies host rules to a root's inline prose, emitting decoration ranges by
// canonical block/cell path. Leaf code blocks have no inline text and are
// skipped here; `code` highlights those instead.
export function resolveBlockDecorationRanges(
  block: Block,
  rootIndex: number,
  rules: readonly DocumintDecoration[],
): TextDecoration[] {
  return resolveCompiledBlockDecorationRanges(block, rootIndex, compileDecorations(rules));
}

export function resolveCompiledBlockDecorationRanges(
  block: Block,
  rootIndex: number,
  compiledRules: readonly DocumintDecoration[],
): TextDecoration[] {
  if (compiledRules.length === 0) return [];

  const ranges: TextDecoration[] = [];

  visitBlockTree(
    [block],
    {
      enterInlineContainer(nodes, context) {
        for (const { node, start } of inlineNodesWithEditorRanges(nodes)) {
          if (node.type === "text" && node.marks.length === 0) {
            appendTextDecorations(ranges, node.text, compiledRules, context.path, start);
          }
        }
        return "skip";
      },
    },
    { startIndex: rootIndex },
  );

  return ranges;
}
