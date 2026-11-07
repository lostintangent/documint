import { normalizeResourceProtocol, type MentionTarget } from "@/document";
import type { MarkdownOptions } from "../shared";

export type MarkdownParseContext = {
  // Keyed by normalized label, and the first definition wins.
  linkReferences: Map<string, LinkReferenceDefinition>;
  // Longest name first, so the longest bare mention wins.
  mentionTargets: readonly MentionTarget[] | null;
  resourceProtocols: ReadonlySet<string> | null;
};

export type LinkReferenceDefinition = {
  title: string | null;
  url: string;
};

export function createMarkdownParseContext({
  mentionTargets,
  resourceProtocols,
}: MarkdownOptions): MarkdownParseContext {
  return {
    linkReferences: new Map(),
    mentionTargets: mentionTargets?.length
      ? [...mentionTargets].sort((left, right) => right.name.length - left.name.length)
      : null,
    resourceProtocols: resourceProtocols?.length
      ? new Set(
          resourceProtocols.map(normalizeResourceProtocol).filter((protocol) => protocol !== null),
        )
      : null,
  };
}
