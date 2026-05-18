import type { EditorPresence } from "@/editor";

export function resolvePresenceName(presence: EditorPresence) {
  return (presence.fullName ?? presence.username).trim() || "Presence";
}
