import { visitBlockTree, type Block } from "@/document";
import type { TextDecoration } from "@/editor";
import type { DocumintDecoration } from "../shared";
import { normalizeLanguage } from "../grammars";
import { appendTextDecorations, compileDecorations } from "./matching";

// Pre-compiles each language's resolved rules into the regex form the code pass
// runs. Shared by the worker configure step and benchmarks.
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
// each block's source into colored ranges at its block path.
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

        appendTextDecorations(ranges, node.source, compiled, context.path);
      },
    },
    { startIndex: rootIndex },
  );

  return ranges;
}
