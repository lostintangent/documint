// Worker-boundary serialization for decoration rules. RegExp objects are not
// structured-clone safe, so rules are converted to plain objects before
// postMessage and reconstructed on the other side.

export type DocumintDecoration = {
  backgroundColor?: string;
  color?: string;
  pattern: RegExp;
};

export type SerializedDecorationRule = {
  backgroundColor?: string;
  color?: string;
  flags: string;
  source: string;
};

export function hasDecorationRuleStyle(rule: DocumintDecoration) {
  return Boolean(rule.backgroundColor || rule.color);
}

export function serializeDecorationRules(
  rules: readonly DocumintDecoration[],
): SerializedDecorationRule[] {
  return rules.filter(hasDecorationRuleStyle).map(({ backgroundColor, color, pattern }) => ({
    backgroundColor,
    color,
    flags: pattern.flags.replace(/g|y/g, ""),
    source: pattern.source,
  }));
}

export function deserializeDecorationRules(
  rules: readonly SerializedDecorationRule[],
): DocumintDecoration[] {
  return rules.map(({ backgroundColor, color, flags, source }) => ({
    backgroundColor,
    color,
    // Force global so we can iterate all matches; strip sticky (y) semantics.
    pattern: new RegExp(source, flags.includes("g") ? flags : `${flags}g`),
  }));
}

// Returns a stable string key for a rule set, suitable as a cache/stale-check
// token without sending RegExp objects across the worker boundary.
export function resolveDecorationRulesKey(rules: readonly DocumintDecoration[]): string {
  return rules
    .filter(hasDecorationRuleStyle)
    .map(
      ({ backgroundColor, color, pattern }) =>
        `${pattern.source}:${pattern.flags}:${color ?? ""}:${backgroundColor ?? ""}`,
    )
    .join("|");
}
