import type { CodeGrammarRule } from "@/types";

// Basic JavaScript/TypeScript lexer: an ordered, first-match-wins regex pass.
// Not a contextual grammar — comments and strings lead so their interiors are
// claimed before keyword/identifier rules can match inside them.
export const javascript: readonly CodeGrammarRule[] = [
  { pattern: /\/\/[^\n]*|\/\*[\s\S]*?\*\//, token: "comment" },
  { pattern: /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`/, token: "string" },
  {
    pattern:
      /\b(?:const|let|var|function|return|if|else|for|while|do|switch|case|break|continue|import|export|from|default|class|extends|new|await|async|yield|typeof|instanceof|in|of|void|delete|this|super|try|catch|finally|throw|interface|type|enum|implements|public|private|protected|readonly|static|abstract|as|is|keyof|namespace|declare)\b/,
    token: "keyword",
  },
  { pattern: /\b(?:true|false|null|undefined|NaN|Infinity)\b/, token: "atom" },
  { pattern: /\b0[xX][\da-fA-F]+|\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/, token: "number" },
  { pattern: /\b[A-Za-z_$][\w$]*(?=\s*\()/, token: "function" },
  { pattern: /\b[A-Z][\w$]*\b/, token: "type" },
];
