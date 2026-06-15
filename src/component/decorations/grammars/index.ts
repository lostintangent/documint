// UI-side code grammar configuration: built-in grammars, language normalization,
// and token-to-color resolution. The worker owns actual source matching.

import type { CodeGrammarRule, CodeTokenKind, DocumintDecoration } from "@/types";
import { javascript } from "./javascript";
import { markdown } from "./markdown";

// Grammars shipped enabled by default. Hosts merge additional languages over
// this set via the `grammars` prop; TypeScript reuses the JavaScript grammar
// (the lexer is shared) so the alias costs no extra bytes.
export const builtinGrammars: Record<string, readonly CodeGrammarRule[]> = {
  javascript,
  typescript: javascript,
  markdown,
};

// Common fenced-language aliases that normalize onto the canonical grammar keys,
// so a fence like ```ts or ```js resolves without duplicating grammar data.
const LANGUAGE_ALIASES: Record<string, string> = {
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  node: "javascript",
  ts: "typescript",
  tsx: "typescript",
  mts: "typescript",
  cts: "typescript",
  md: "markdown",
  mdx: "markdown",
  markdn: "markdown",
};

export function normalizeLanguage(language: string | null): string | null {
  if (!language) {
    return null;
  }

  const key = language.trim().toLowerCase();
  if (!key) {
    return null;
  }

  return LANGUAGE_ALIASES[key] ?? key;
}

// The single normalization point for the language lookup table: grammar keys are
// normalized the same way code-fence languages are, so an aliased key like `tsx`
// or `js` lands under the canonical name the worker looks up by. On collision the
// later entry wins — host grammars merge after built-ins, so a host override of a
// built-in language takes precedence.
export function resolveCodeGrammars(
  grammars: Record<string, readonly CodeGrammarRule[]>,
  tokenColor: (token: CodeTokenKind) => string,
): Record<string, DocumintDecoration[]> {
  const resolved: Record<string, DocumintDecoration[]> = {};

  for (const [language, rules] of Object.entries(grammars)) {
    const key = normalizeLanguage(language);
    if (!key) {
      continue;
    }

    const decorationRules = resolveTokenDecorationRules(rules, tokenColor);
    if (decorationRules.length > 0) {
      resolved[key] = decorationRules;
    }
  }

  return resolved;
}

// Resolves a language's token rules to plain color decorations.
function resolveTokenDecorationRules(
  rules: readonly CodeGrammarRule[],
  tokenColor: (token: CodeTokenKind) => string,
): DocumintDecoration[] {
  return rules.map((rule) => ({ pattern: rule.pattern, color: tokenColor(rule.token) }));
}
