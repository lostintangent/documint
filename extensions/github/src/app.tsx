import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Documint,
  type Anchor,
  type CommentChange,
  type DocumentPresence,
  type DocumentUser,
  type UserMentionEvent,
} from "@lostintangent/documint";
import type { Dispatch, SetStateAction } from "react";
import { useServerEvents } from "./hooks/useServerEvents";
import { useStorage } from "./hooks/useStorage";
import { useTheme } from "./hooks/useTheme";
import type { CopilotJob, FetchJsonError, ServerContent, ServerEvent, ServerState } from "./types";

type AddedCommentChange = Extract<CommentChange, { kind: "added" }>;
type CopilotTrigger = "direct-mention" | "thread-reply";
type SetError = Dispatch<SetStateAction<string | null>>;

const instanceId = new URLSearchParams(window.location.search).get("instanceId");
const clientId = createClientId();

function App() {
  const documentState = useDocumentState(instanceId);
  const { content, copilotUser, flushLocalEdits, handleContentChanged, jobs, error } =
    documentState;
  const { handleCommentChanged, handleUserMentioned } = useCopilotTriggers({
    copilotUser,
    flushLocalEdits,
    instanceId,
    setError: documentState.setError,
    upsertRunningJob: documentState.upsertRunningJob,
  });
  const users = useMemo(() => [copilotUser], [copilotUser]);
  const storage = useStorage(instanceId);
  const presence = useMemo(
    () => createCopilotPresence(jobs, copilotUser.id),
    [copilotUser.id, jobs],
  );
  const theme = useTheme();
  useViewportResizeNotifier();

  return (
    <>
      <style>{styles}</style>
      <main className="shell">
        {content === null ? (
          <section className="state">{error || "Loading Documint..."}</section>
        ) : (
          <>
            <Documint
              className="documint-canvas-frame"
              content={content}
              onCommentChanged={handleCommentChanged}
              onContentChanged={handleContentChanged}
              onUserMentioned={handleUserMentioned}
              presence={presence}
              storage={storage}
              theme={theme}
              users={users}
            />
            {error ? (
              <p className="status" role="status">
                {error}
              </p>
            ) : null}
          </>
        )}
      </main>
    </>
  );
}

function useDocumentState(instanceId: string | null) {
  const [serverContent, setServerContent] = useState<ServerContent | null>(null);
  const [copilotUser, setCopilotUser] = useState<DocumentUser>({
    id: "copilot",
    username: "copilot",
    fullName: "Copilot",
  });
  const [jobs, setJobs] = useState<CopilotJob[]>([]);
  const [error, setError] = useState<string | null>(null);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const saveFailureRef = useRef<FetchJsonError | null>(null);
  const baseRevisionRef = useRef(0);

  // Documint applies new content in its own layout effect, which runs before
  // this parent one, so every edit from here on builds on this revision.
  useLayoutEffect(() => {
    baseRevisionRef.current = serverContent?.revision ?? 0;
  }, [serverContent]);

  const saveEdit = async (content: string) => {
    const baseRevision = baseRevisionRef.current;
    const runSave = async () => {
      try {
        await fetchJson<ServerState>(
          `/api/content?instanceId=${encodeInstanceId(instanceId)}`,
          "PUT",
          { baseRevision, clientId, content },
        );
        saveFailureRef.current = null;
        setError(null);
      } catch (error) {
        if (isFetchJsonError(error) && error.status === 409 && error.payload.state) {
          setServerContent(error.payload.state);
          saveFailureRef.current = error;
          setError("The file changed before this edit could be applied.");
        }
        if (!isFetchJsonError(error) || error.status !== 409) {
          throw error;
        }
      }
    };

    const savePromise = saveQueueRef.current.catch(() => {}).then(runSave);
    saveQueueRef.current = savePromise;
    await savePromise;
  };

  const handleServerEvent = (payload: ServerEvent) => {
    if (payload.type === "state") {
      setServerContent(payload.state);
      setCopilotUser(payload.state.copilotUser);
      setJobs(payload.state.jobs ?? []);
      saveFailureRef.current = null;
      setError(null);
    } else if (payload.type === "content") {
      setServerContent(payload);
      saveFailureRef.current = null;
      setError(null);
    } else if (payload.type === "job") {
      setJobs(payload.jobs ?? []);
    } else if (payload.type === "error") {
      setError(payload.message);
    }
  };

  useServerEvents({
    clientId,
    instanceId,
    onConnectionError: () => setError("Reconnecting to the extension..."),
    onEvent: handleServerEvent,
    onInvalidEvent: () => setError("Received an invalid update from the extension."),
  });

  const handleContentChanged = (nextContent: string) => {
    void saveEdit(nextContent).catch((error) => {
      setError(getErrorMessage(error));
    });
  };

  const flushLocalEdits = async () => {
    await saveQueueRef.current;
    if (saveFailureRef.current) {
      throw saveFailureRef.current;
    }
  };

  const upsertRunningJob = (job: CopilotJob) => {
    setJobs((currentJobs) => upsertJob(currentJobs, job));
  };

  return {
    content: serverContent?.content ?? null,
    copilotUser,
    flushLocalEdits,
    handleContentChanged,
    jobs,
    error: instanceId ? error : "Missing canvas instance id.",
    setError,
    upsertRunningJob,
  };
}

function useCopilotTriggers({
  copilotUser,
  flushLocalEdits,
  instanceId,
  setError,
  upsertRunningJob,
}: {
  copilotUser: DocumentUser;
  flushLocalEdits: () => Promise<void>;
  instanceId: string | null;
  setError: SetError;
  upsertRunningJob: (job: CopilotJob) => void;
}) {
  const startCopilotJob = async (path: string, body: unknown) => {
    await flushLocalEdits();
    const nextJob = await fetchJson<CopilotJob>(
      `${path}?instanceId=${encodeInstanceId(instanceId)}`,
      "POST",
      body,
    );
    upsertRunningJob(nextJob);
    setError(null);
  };

  const handleCommentChanged = (change: CommentChange) => {
    if (change.kind !== "added") {
      return;
    }

    const trigger = resolveCopilotTrigger(change, copilotUser.id);
    if (!trigger) {
      return;
    }

    void startCopilotJob("/api/copilot-comment", {
      body: change.comment.body,
      mentionedUserIds: change.mentionedUserIds,
      source: trigger === "thread-reply" ? "reply" : "comment",
      thread: change.thread,
      threadId: change.threadId,
      trigger,
    }).catch((error) => setError(getErrorMessage(error)));
  };

  const handleUserMentioned = (event: UserMentionEvent) => {
    if (event.userId !== copilotUser.id && !mentionsCopilot(event.lineMarkdown)) {
      return;
    }

    void startCopilotJob("/api/copilot-user-mention", {
      cursor: createCursorAnchorForMentionLine(event.lineMarkdown),
      lineMarkdown: event.lineMarkdown,
      lineNumber: event.lineNumber,
      userId: event.userId,
    }).catch((error) => setError(getErrorMessage(error)));
  };

  return { handleCommentChanged, handleUserMentioned };
}

function useViewportResizeNotifier() {
  useEffect(() => {
    const notifyViewportChanged = () => {
      window.requestAnimationFrame(() => window.dispatchEvent(new Event("resize")));
    };

    window.addEventListener("focus", notifyViewportChanged);
    window.addEventListener("pageshow", notifyViewportChanged);
    document.addEventListener("visibilitychange", notifyViewportChanged);

    return () => {
      window.removeEventListener("focus", notifyViewportChanged);
      window.removeEventListener("pageshow", notifyViewportChanged);
      document.removeEventListener("visibilitychange", notifyViewportChanged);
    };
  }, []);
}

function resolveCopilotTrigger(
  change: AddedCommentChange,
  copilotUserId: string,
): CopilotTrigger | null {
  if (change.mentionedUserIds.includes(copilotUserId) || mentionsCopilot(change.comment.body)) {
    return "direct-mention";
  }

  const previousComments = change.thread.comments.slice(0, -1);
  return previousComments.some((comment) => mentionsCopilot(comment.body)) ? "thread-reply" : null;
}

function upsertJob(jobs: CopilotJob[], job: CopilotJob): CopilotJob[] {
  const nextJobs = jobs.filter((candidate) => candidate.id !== job.id);
  return job.state === "running" ? [...nextJobs, job] : nextJobs;
}

function createCopilotPresence(jobs: CopilotJob[], copilotUserId: string): DocumentPresence[] {
  return jobs.flatMap((candidate) => {
    if (candidate.state !== "running") {
      return [];
    }

    const cursor =
      candidate.cursor ?? (candidate.threadId ? { threadId: candidate.threadId } : undefined);
    const status = candidate.message?.trim();
    return [
      {
        userId: copilotUserId,
        color: "#8b5cf6",
        ...(cursor ? { cursor } : {}),
        ...(status ? { status } : {}),
      },
    ];
  });
}

function mentionsCopilot(body: string): boolean {
  return /(^|[^\w-])@copilot\b/i.test(body);
}

function createCursorAnchorForMentionLine(line: string): Anchor {
  const mention = /@copilot\b/i.exec(line);

  if (mention) {
    const mentionEnd = mention.index + mention[0].length;
    return {
      prefix: line.slice(0, mentionEnd),
      suffix: line.slice(mentionEnd) || undefined,
    };
  }

  return { prefix: line };
}

function createClientId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `documint-${Date.now()}-${Math.random().toString(16).slice(2)}`
  );
}

function encodeInstanceId(instanceId: string | null): string {
  return encodeURIComponent(instanceId ?? "");
}

async function fetchJson<T>(url: string, method: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method,
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
  const payload = (await response.json()) as { error?: string; state?: ServerState };
  if (!response.ok) {
    const error = new Error(
      payload.error ?? `Request failed with ${response.status}`,
    ) as FetchJsonError;
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload as T;
}

function isFetchJsonError(error: unknown): error is FetchJsonError {
  return error instanceof Error && "status" in error && "payload" in error;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const styles = `
* { box-sizing: border-box; }
html, body, #root {
  height: 100%;
  margin: 0;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
  width: 100%;
}
body {
  background: var(--documint-agent-background, #0d1117);
  color: var(--documint-agent-text, #f0f6fc);
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  overflow: hidden;
}
.shell {
  display: grid;
  grid-template-rows: minmax(0, 1fr);
  height: 100dvh;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
  width: 100vw;
}
.documint-canvas-frame {
  display: block;
  height: 100%;
  min-height: 0;
  min-width: 0;
  width: 100%;
}
.state {
  align-items: center;
  display: grid;
  height: 100%;
  justify-items: center;
  min-height: 0;
  padding: 1rem;
  text-align: center;
}
.status {
  border-top: 1px solid color-mix(in srgb, currentColor 20%, transparent);
  font-size: 0.8125rem;
  margin: 0;
  padding: 0.375rem 0.75rem;
}
`;

createRoot(document.getElementById("root")!).render(<App />);
