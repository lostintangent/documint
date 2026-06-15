import { visitBlockTree, type Block } from "@/document";
import type { TextDecoration } from "@/editor";
import type { DocumintDecoration } from "@/types";
import { compileDecorations, resolveDecorationMatches } from "./matching";

// Applies host rules to a root's inline prose, emitting decoration ranges by
// region path. Leaf code blocks have no inline text and are skipped here;
// `code` highlights those instead.
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
      enterPlainText(text, context) {
        for (const match of resolveDecorationMatches(text, compiledRules)) {
          const { end, start, ...decoration } = match;
          ranges.push({
            ...decoration,
            endOffset: context.startOffset + end,
            path: context.path,
            startOffset: context.startOffset + start,
          });
        }
      },
    },
    { startIndex: rootIndex },
  );

  return ranges.sort((a, b) => a.startOffset - b.startOffset);
}
