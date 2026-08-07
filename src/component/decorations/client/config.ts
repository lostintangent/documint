import type { DocumintDecoration } from "@/types";
import type { SerializedDecoration } from "../shared";

type DecorationPaint = Pick<DocumintDecoration, "backgroundColor" | "color">;

export function isValidDecoration(decoration: DecorationPaint) {
  return Boolean(decoration.backgroundColor || decoration.color);
}

export function serializeDecorations(rules: readonly DocumintDecoration[]): SerializedDecoration[] {
  return rules.filter(isValidDecoration).map(({ backgroundColor, pulse, color, pattern }) => ({
    backgroundColor,
    ...(backgroundColor && pulse && { pulse: true }),
    color,
    flags: pattern.flags.replace(/g|y/g, ""),
    source: pattern.source,
  }));
}

// Returns a stable string key for a rule set, suitable as a cache/stale-check
// token without sending RegExp objects across the worker boundary.
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
