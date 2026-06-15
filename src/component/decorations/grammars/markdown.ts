import type { CodeGrammarRule } from "@/types";

// Basic Markdown lexer for fenced ```markdown blocks. Line-anchored rules use
// the multiline flag so headings, list markers, and quotes match per line
// across the whole source.
export const markdown: readonly CodeGrammarRule[] = [
  { pattern: /^#{1,6}\s.*$/m, token: "heading" },
  { pattern: /`[^`\n]+`/, token: "string" },
  { pattern: /\*\*[^*\n]+\*\*|__[^_\n]+__/, token: "strong" },
  { pattern: /\*[^*\n]+\*|_[^_\n]+_/, token: "emphasis" },
  { pattern: /\[[^\]\n]*\]\([^)\n]*\)/, token: "link" },
  { pattern: /^[ \t]{0,3}(?:-{3,}|\*{3,}|_{3,})[ \t]*$/m, token: "punctuation" },
  { pattern: /^[ \t]*(?:[-*+]|\d+\.)[ \t]/m, token: "punctuation" },
  { pattern: /^[ \t]*>.*$/m, token: "comment" },
  { pattern: /^```.*$/m, token: "keyword" },
];
