import { sourcePath, visitBlockTree, type Block } from "@/document";
import type { TextDecoration } from "@/editor";
import type { DocumintDecoration } from "@/types";
import { normalizeLanguage } from "../grammars";
import { compileDecorations, resolveDecorationMatches } from "./matching";

// Pre-compiles each language's resolved rules into the regex form the code pass
// runs. Shared by the worker (after deserializing wire config) and benchmarks.
export function compileCodeGrammars(
  rulesByLanguage: Record<string, readonly DocumintDecoration[]>,
): Record<string, DocumintDecoration[]> {
  const compiled: Record<string, DocumintDecoration[]> = {};

  for (const [language, rules] of Object.entries(rulesByLanguage)) {
    compiled[language] = compileDecorations(rules);
  }

  return compiled;
}

// Code blocks larger than this render plain. Highlighting a giant blob (a
// minified bundle pasted into a fence) has little value and bounds the worst-
// case work the regex engine sees per block.
const MAX_CODE_SOURCE_LENGTH = 100_000;

// The code-targeting decoration pass: walk a root for code blocks and tokenize
// each block's source into colored ranges at its source-region path.
export function resolveCodeDecorationRanges(
  block: Block,
  rootIndex: number,
  grammars: Record<string, readonly DocumintDecoration[]>,
): TextDecoration[] {
  if (Object.keys(grammars).length === 0) return [];

  const ranges: TextDecoration[] = [];

  visitBlockTree(
    [block],
    {
      enterBlock(node, context) {
        if (node.type !== "code" || node.source.length > MAX_CODE_SOURCE_LENGTH) {
          return;
        }

        const language = normalizeLanguage(node.language);
        const compiled = language ? grammars[language] : undefined;
        if (!compiled || compiled.length === 0) {
          return;
        }

        const path = sourcePath(context.path);
        for (const match of resolveDecorationMatches(node.source, compiled)) {
          const { end, start, ...decoration } = match;
          ranges.push({
            ...decoration,
            endOffset: end,
            path,
            startOffset: start,
          });
        }
      },
    },
    { startIndex: rootIndex },
  );

  return ranges.sort((a, b) => a.startOffset - b.startOffset);
}
