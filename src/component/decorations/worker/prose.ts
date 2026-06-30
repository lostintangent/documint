import { visitBlockTree, type Block, type Inline } from "@/document";
import type { TextDecoration } from "@/editor";
import { inlineNodesWithEditorRanges } from "@/editor/text/inline-offsets";
import type { DocumintDecoration } from "@/types";
import { compileDecorations, resolveDecorationMatches } from "./matching";

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
        resolveInlineDecorationRanges(nodes, context.path, compiledRules, ranges);
        return "skip";
      },
    },
    { startIndex: rootIndex },
  );

  return ranges.sort((a, b) => a.startOffset - b.startOffset);
}

function resolveInlineDecorationRanges(
  nodes: readonly Inline[],
  path: string,
  compiledRules: readonly DocumintDecoration[],
  ranges: TextDecoration[],
) {
  for (const { node, start: rangeStart } of inlineNodesWithEditorRanges(nodes)) {
    if (node.type !== "text" || node.marks.length > 0) {
      continue;
    }

    for (const match of resolveDecorationMatches(node.text, compiledRules)) {
      const { end, start, ...decoration } = match;
      ranges.push({
        ...decoration,
        endOffset: rangeStart + end,
        path,
        startOffset: rangeStart + start,
      });
    }
  }
}
