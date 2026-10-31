import type { MentionTarget } from "@/document";
import { normalizeResourceProtocols, type MarkdownOptions } from "../shared";

export type MarkdownParseContext = {
  mentionTargets: readonly MentionTarget[] | null;
  options: MarkdownOptions;
  resourceProtocols: ReadonlySet<string> | null;
};

export function createMarkdownParseContext(options: MarkdownOptions): MarkdownParseContext {
  return {
    mentionTargets: sortMentionTargets(options.mentionTargets),
    options,
    resourceProtocols: normalizeResourceProtocols(options.resourceProtocols),
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
