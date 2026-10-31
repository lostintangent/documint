// Mention-domain helpers shared by comment rendering and comment-change
// payloads. Both read committed comment text through `parseFragment` with the
// same roster, so the IDs reported to hosts are exactly the mentions the
// comment leaf pills.
import { createParagraphBlock, visitBlockTree, type MentionTarget } from "@/document";
import { parseFragment } from "@/markdown";
import type { CompletionSource } from "../completions/completions";

// The mention roster is whatever was wired into the "@" completion source.
// Items without an ID can be completed as text but never resolve to a user.
export function resolveMentionTargets(
  completionSources: CompletionSource[] | undefined,
): MentionTarget[] | undefined {
  const source = completionSources?.find((candidate) => candidate.trigger === "@");

  if (!source) {
    return undefined;
  }

  return source.items.flatMap<MentionTarget>((item) =>
    item.id ? [{ name: item.label, userId: item.id }] : [],
  );
}

// Pull the IDs of users mentioned in `body`, deduped and in first-occurrence
// order.
export function extractMentionedUserIds(
  body: string,
  completionSources: CompletionSource[] | undefined,
): string[] {
  const fragment = parseFragment(body, {
    mentionTargets: resolveMentionTargets(completionSources),
  });
  const blocks =
    fragment.kind === "blocks"
      ? fragment.blocks
      : fragment.kind === "inlines"
        ? [createParagraphBlock(fragment.inlines)]
        : [];
  const userIds = new Set<string>();

  visitBlockTree(blocks, {
    enterInline: (node) => {
      if (node.type === "mention") {
        userIds.add(node.userId);
      }
    },
  });

  return [...userIds];
}
