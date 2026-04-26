import type { DocumentPresence, DocumentUser, DocumentUserPresence } from "@/types";

/**
 * Joins the host-provided `users` roster with the active `presence` list by
 * `userId`, producing the denormalized internal shape consumed by the
 * presence pipeline.
 *
 * Presence entries whose `userId` doesn't match a user in the roster are
 * silently dropped — the roster is the source of truth for "who this person
 * is." Returns `undefined` (rather than an empty array) when there's nothing
 * to render so consumers can use a single typed branch for the empty case.
 */
export function joinUsersAndPresence(
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
