import { useMemo } from "react";
import type { DocumentPresence, DocumentUser, DocumentUserPresence } from "@/types";
import { presenceActiveCommentThreadColorsValue, presenceValue, useStoreValue } from "../store";

// Component-side presence bridge. The hook joins host user/presence props,
// then subscribes to the store values needed by paint: resolved text-cursor
// presence for the overlay and comment-thread presence colors for content.
export function usePresence({
  presence,
  users,
}: {
  presence?: DocumentPresence[];
  users?: DocumentUser[];
}) {
  const userPresence = useMemo(() => joinUsersAndPresence(users, presence), [users, presence]);
  const activeCommentThreadColors = useStoreValue(
    presenceActiveCommentThreadColorsValue,
    userPresence,
  );
  const resolvedPresence = useStoreValue(presenceValue, userPresence);

  return {
    activeCommentThreadColors,
    resolvedPresence,
  };
}

function joinUsersAndPresence(
  users: DocumentUser[] | undefined,
  presence: DocumentPresence[] | undefined,
): DocumentUserPresence[] | undefined {
  if (!presence?.length || !users?.length) {
    return undefined;
  }

  const usersById = new Map(users.map((user) => [user.id, user]));
  const resolved: DocumentUserPresence[] = [];

  for (const entry of presence) {
    const user = usersById.get(entry.userId);
    if (!user) continue;
    resolved.push({ ...user, color: entry.color, cursor: entry.cursor });
  }

  return resolved.length === 0 ? undefined : resolved;
}
