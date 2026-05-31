import { useMemo } from "react";
import type { DocumentPresence, DocumentUser, DocumentUserPresence } from "@/types";
import { commentPresenceSprig, resolvedPresenceSprig, useSprig } from "../store";

export function usePresence({
  presence,
  users,
}: {
  presence?: DocumentPresence[];
  users?: DocumentUser[];
}) {
  /* Host presence join */

  const documentUserPresence = useMemo(
    () => joinUsersAndPresence(users, presence),
    [users, presence],
  );

  /* Presence view models */

  const commentPresence = useSprig(commentPresenceSprig, documentUserPresence);
  const resolvedPresence = useSprig(resolvedPresenceSprig, documentUserPresence);

  /* Public API */

  return {
    commentPresence,
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
    resolved.push({ ...user, color: entry.color, cursor: entry.cursor, status: entry.status });
  }

  return resolved.length === 0 ? undefined : resolved;
}
