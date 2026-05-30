import type { MentionTarget } from "@/document";
import { normalizeResourceProtocols, type MarkdownOptions } from "../shared";

export type MarkdownParseContext = {
  baseIndent: number;
  mentionTargets: readonly MentionTarget[] | null;
  options: MarkdownOptions;
  resourceProtocols: ReadonlySet<string> | null;
};

export function createMarkdownParseContext(
  options: MarkdownOptions,
  baseIndent = 0,
): MarkdownParseContext {
  return {
    baseIndent,
    mentionTargets: sortMentionTargets(options.mentionTargets),
    options,
    resourceProtocols: normalizeResourceProtocols(options.resourceProtocols),
  };
}

export function withBaseIndent(
  context: MarkdownParseContext,
  baseIndent: number,
): MarkdownParseContext {
  return context.baseIndent === baseIndent
    ? context
    : {
        ...context,
        baseIndent,
      };
}

function sortMentionTargets(
  targets: readonly MentionTarget[] | undefined,
): readonly MentionTarget[] | null {
  if (!targets?.length) {
    return null;
  }

  return [...targets].sort((left, right) => right.name.length - left.name.length);
}
