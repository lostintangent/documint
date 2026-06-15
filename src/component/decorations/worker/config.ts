import type { DocumintDecoration } from "@/types";
import type { SerializedDecoration } from "../shared";

export function deserializeDecorations(
  rules: readonly SerializedDecoration[],
): DocumintDecoration[] {
  return rules.map(({ backgroundColor, pulse, color, flags, source }) => ({
    backgroundColor,
    ...(backgroundColor && pulse && { pulse: true }),
    color,
    // Force global so we can iterate all matches; strip sticky (y) semantics.
    pattern: new RegExp(source, flags.includes("g") ? flags : `${flags}g`),
  }));
}
