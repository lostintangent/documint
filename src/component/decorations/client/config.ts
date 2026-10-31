import { isValidDecoration, type DocumintDecoration } from "../shared";

// Returns a stable string key for a rule set, suitable as a cache/stale-check
// token without comparing RegExp objects.
export function resolveDecorationsKey(rules: readonly DocumintDecoration[]): string {
  return rules
    .filter(isValidDecoration)
    .map(
      ({ backgroundColor, pulse, color, pattern }) =>
        `${pattern.source}:${pattern.flags}:${color ?? ""}:${backgroundColor ?? ""}:${
          backgroundColor && pulse ? 1 : 0
        }`,
    )
    .join("|");
}
