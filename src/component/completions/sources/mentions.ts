import type { DocumentUser } from "@/types";
import type { CompletionSource } from "../completions";

export function createMentionCompletionSource(
  users: readonly DocumentUser[] | undefined,
): CompletionSource | null {
  if (!users?.length) {
    return null;
  }

  return {
    trigger: "@",
    items: users
      .map((user) => ({
        id: user.id,
        kind: "mention" as const,
        label: user.fullName ?? user.username,
      }))
      .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" })),
  };
}
