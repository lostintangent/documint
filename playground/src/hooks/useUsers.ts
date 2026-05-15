import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DocumentPresence, DocumentUser } from "documint";
import { createRandomAutoPresence } from "./lib/auto-presence";

type ManualEntry = {
  user: DocumentUser;
  presence: DocumentPresence;
};

export type UsersMode = "auto" | "empty" | "manual";

const autoUser: DocumentUser = {
  id: "auto-user",
  username: "User",
};

const autoPresenceTickMs = 2200;

export function useUsers(content: string) {
  const contentRef = useRef(content);
  const [manualName, setManualName] = useState("");
  const [manualAvatarUrl, setManualAvatarUrl] = useState("");
  const [manualAnchorPrefix, setManualAnchorPrefix] = useState("");
  const [manualAnchorSuffix, setManualAnchorSuffix] = useState("");
  const [manualThreadId, setManualThreadId] = useState("");
  const [manualColor, setManualColor] = useState("#0ea5e9");
  const [manualEntries, setManualEntries] = useState<ManualEntry[]>([]);
  const [autoMode, setAutoMode] = useState(false);
  const [autoPresence, setAutoPresence] = useState<DocumentPresence | null>(null);

  const mode: UsersMode = autoMode ? "auto" : manualEntries.length > 0 ? "manual" : "empty";

  contentRef.current = content;

  const users = useMemo<DocumentUser[]>(() => {
    if (autoMode) return [autoUser];
    return manualEntries.map((entry) => entry.user);
  }, [autoMode, manualEntries]);

  const presence = useMemo<DocumentPresence[]>(() => {
    if (autoMode) return autoPresence ? [autoPresence] : [];
    return manualEntries.map((entry) => entry.presence);
  }, [autoMode, autoPresence, manualEntries]);

  const reset = useCallback(() => {
    setManualEntries([]);
    setManualName("");
    setManualAvatarUrl("");
    setManualAnchorPrefix("");
    setManualAnchorSuffix("");
    setManualThreadId("");
    setAutoPresence(null);
  }, []);

  useEffect(() => {
    if (!autoMode) {
      setAutoPresence(null);
      return;
    }

    const tick = () => {
      setAutoPresence(createRandomAutoPresence(contentRef.current, autoUser.id));
    };

    tick();

    const intervalId = window.setInterval(tick, autoPresenceTickMs);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [autoMode]);

  return {
    users,
    presence,
    mode,
    auto: {
      presence: autoPresence,
      user: autoUser,
      enabled: autoMode,
      setEnabled: setAutoMode,
    },
    manualForm: {
      avatarUrl: manualAvatarUrl,
      canAddEntry: manualName.trim().length > 0,
      color: manualColor,
      name: manualName,
      prefix: manualAnchorPrefix,
      setAvatarUrl: setManualAvatarUrl,
      setColor: setManualColor,
      setName: setManualName,
      setPrefix: setManualAnchorPrefix,
      setSuffix: setManualAnchorSuffix,
      setThreadId: setManualThreadId,
      suffix: manualAnchorSuffix,
      threadId: manualThreadId,
      addEntry() {
        const name = manualName.trim();
        const avatarUrl = manualAvatarUrl.trim();
        const prefix = manualAnchorPrefix.trim();
        const suffix = manualAnchorSuffix.trim();
        const threadId = manualThreadId.trim();

        if (name.length === 0) {
          return;
        }

        setManualEntries((current) => [
          ...current,
          createManualEntry(name, avatarUrl, prefix, suffix, threadId, manualColor, current.length),
        ]);
        setManualName("");
        setManualAvatarUrl("");
        setManualAnchorPrefix("");
        setManualAnchorSuffix("");
        setManualThreadId("");
      },
    },
    manualEntries: {
      items: manualEntries,
      removeEntry(userId: string) {
        setManualEntries((current) => current.filter((entry) => entry.user.id !== userId));
      },
    },
    reset,
  };
}

function createManualEntry(
  name: string,
  avatarUrl: string,
  prefix: string,
  suffix: string,
  threadId: string,
  color: string,
  index: number,
): ManualEntry {
  const id = `manual-${Date.now()}-${index}`;
  const user: DocumentUser = { id, username: name };

  if (avatarUrl) {
    user.avatarUrl = avatarUrl;
  }

  const presence: DocumentPresence = { userId: id, color };
  const cursor = createPresenceCursor(prefix, suffix, threadId);

  if (cursor) {
    presence.cursor = cursor;
  }

  return { user, presence };
}

function createPresenceCursor(
  prefix: string,
  suffix: string,
  threadId: string,
): DocumentPresence["cursor"] {
  if (threadId.length > 0) {
    return { threadId };
  }

  if (prefix.length === 0 && suffix.length === 0) {
    return undefined;
  }

  return {
    ...(prefix ? { prefix } : {}),
    ...(suffix ? { suffix } : {}),
  };
}

export function describeEntry(user: DocumentUser, presence: DocumentPresence | null) {
  const name = (user.fullName ?? user.username).trim() || "User";
  const cursor = presence?.cursor;

  if (!cursor) {
    return name;
  }

  if ("threadId" in cursor) {
    return `${name}: comment ${cursor.threadId}`;
  }

  if (cursor.prefix && cursor.suffix) {
    return `${name}: between "${cursor.prefix}" and "${cursor.suffix}"`;
  }

  if (cursor.prefix) {
    return `${name}: after "${cursor.prefix}"`;
  }

  return `${name}: before "${cursor.suffix ?? ""}"`;
}
