import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { DocumentPresence, DocumentUser } from "@lostintangent/documint";
import { createRandomAutoPresence } from "../lib/auto-presence";

type ManualEntry = {
  user: DocumentUser;
  presence: DocumentPresence;
};

export type ManualFormField =
  | "avatarUrl"
  | "color"
  | "name"
  | "prefix"
  | "status"
  | "suffix"
  | "threadId";

type ManualForm = Record<ManualFormField, string>;

export type UsersMode = "auto" | "empty" | "manual";

const autoUser: DocumentUser = {
  id: "auto-user",
  username: "User",
};

const autoPresenceTickMs = 2200;

// Adding an entry clears every field except color, so the next user keeps the picked swatch.
const clearedManualFields = {
  avatarUrl: "",
  name: "",
  prefix: "",
  status: "",
  suffix: "",
  threadId: "",
};

export function useUsers(content: string) {
  const [manualForm, setManualForm] = useState<ManualForm>({
    ...clearedManualFields,
    color: "#0ea5e9",
  });
  const [manualEntries, setManualEntries] = useState<ManualEntry[]>([]);
  const [autoMode, setAutoMode] = useState(false);
  const [autoPresence, setAutoPresence] = useState<DocumentPresence | null>(null);

  if (!autoMode && autoPresence !== null) {
    setAutoPresence(null);
  }

  const contentRef = useRef(content);

  useLayoutEffect(() => {
    contentRef.current = content;
  });

  const mode: UsersMode = autoMode ? "auto" : manualEntries.length > 0 ? "manual" : "empty";

  const users = useMemo<DocumentUser[]>(() => {
    if (autoMode) return [autoUser];
    return manualEntries.map((entry) => entry.user);
  }, [autoMode, manualEntries]);

  const presence = useMemo<DocumentPresence[]>(() => {
    if (autoMode) return autoPresence ? [autoPresence] : [];
    return manualEntries.map((entry) => entry.presence);
  }, [autoMode, autoPresence, manualEntries]);

  useEffect(() => {
    if (!autoMode) {
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
      ...manualForm,
      canAddEntry: manualForm.name.trim().length > 0,
      setField(field: ManualFormField, value: string) {
        setManualForm((current) => ({ ...current, [field]: value }));
      },
      addEntry() {
        if (manualForm.name.trim().length === 0) {
          return;
        }

        setManualEntries((current) => [...current, createManualEntry(manualForm, current.length)]);
        setManualForm((current) => ({ ...current, ...clearedManualFields }));
      },
    },
    manualEntries: {
      items: manualEntries,
      removeEntry(userId: string) {
        setManualEntries((current) => current.filter((entry) => entry.user.id !== userId));
      },
    },
  };
}

function createManualEntry(form: ManualForm, index: number): ManualEntry {
  const id = `manual-${Date.now()}-${index}`;
  const avatarUrl = form.avatarUrl.trim();
  const status = form.status.trim();
  const user: DocumentUser = { id, username: form.name.trim() };

  if (avatarUrl) {
    user.avatarUrl = avatarUrl;
  }

  const presence: DocumentPresence = { userId: id, color: form.color };
  const cursor = createPresenceCursor(form.prefix.trim(), form.suffix.trim(), form.threadId.trim());

  if (status) {
    presence.status = status;
  }

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
  const status = presence?.status?.trim();
  const label = status ? `${name} (${status})` : name;

  if (!cursor) {
    return label;
  }

  if ("threadId" in cursor) {
    return `${label}: comment ${cursor.threadId}`;
  }

  if (cursor.prefix && cursor.suffix) {
    return `${label}: between "${cursor.prefix}" and "${cursor.suffix}"`;
  }

  if (cursor.prefix) {
    return `${label}: after "${cursor.prefix}"`;
  }

  return `${label}: before "${cursor.suffix ?? ""}"`;
}
