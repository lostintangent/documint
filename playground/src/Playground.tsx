import { useState } from "react";
import {
  Documint,
  type CommentChange,
  type DocumentPresence,
  type DocumentUser,
  type DocumintActions,
  type DocumintDecoration,
  type DocumintStorage,
  type UserMentionEvent,
} from "documint";
import { Hand, X } from "lucide-react";
import { fixtureOptions, getThemeOption, themeOptions } from "./data";
import { DiagnosticsPopover } from "./popovers/DiagnosticsPopover";
import { UsersPopover } from "./popovers/UsersPopover";
import { ThemePopover } from "./popovers/ThemePopover";

// In-memory storage for reading/writing pasted images. Hosts in the wild would write to
// disk, S3, etc.; the playground keeps blobs in a Map so paste-to-render
// works without leaving the browser tab.
function createInMemoryStorage(): DocumintStorage {
  const files = new Map<string, Blob>();

  return {
    async readFile(path) {
      return files.get(path) ?? null;
    },
    async writeFile(file) {
      files.set(file.name, file);
      return file.name;
    },
    openFile(_path) {
      window.open("https://github.com/lostintangent/documint", "_blank");
    },
  };
}

const storage = createInMemoryStorage();
const playgroundDecorations: readonly DocumintDecoration[] = [
  { backgroundColor: "#fde047", color: "#111827", pattern: /\bTODO\b/g },
  { color: "#6b7280", pattern: /\((\d+)\)/g },
];

const actions: DocumintActions = {
  selection: {
    icon: Hand,
    label: "Say hi",
    onClick(selectedText) {
      window.alert(`Hi, ${selectedText.trim() || "there"}!`);
    },
  },
};

const fixtureSurfaceClassName =
  "grid h-full min-h-0 min-w-0 grid-rows-[minmax(0,1fr)] overflow-hidden rounded-2xl border border-border/[0.08] bg-background/[0.82] max-[700px]:portrait:h-auto";
const hostEventCodeClassName =
  "font-code [overflow-wrap:anywhere] whitespace-normal rounded-[0.4rem] border border-border/[0.14] bg-background/[0.9] px-[0.35rem] py-[0.15rem]";

type PlaygroundHostEvent = {
  detail: string;
  fields: Array<[string, string | number]>;
  title: string;
};

export function Playground() {
  const [content, setContent] = useState<string>(fixtureOptions[0].markdown);
  const [lastHostEvent, setLastHostEvent] = useState<PlaygroundHostEvent | null>(null);
  const [hostEventVisible, setHostEventVisible] = useState(false);

  const [fixtureId, setFixtureId] = useState<string>(fixtureOptions[0].id);
  const [themeId, setThemeId] = useState<string>(themeOptions[0].id);

  const [users, setUsers] = useState<DocumentUser[]>([]);
  const [presence, setPresence] = useState<DocumentPresence[]>([]);

  const activeThemeOption = getThemeOption(themeId);
  const activeTheme = activeThemeOption.theme;

  const handleFixtureChange = (nextFixtureId: string) => {
    const nextFixture = fixtureOptions.find((candidate) => candidate.id === nextFixtureId);

    if (!nextFixture) {
      return;
    }

    setFixtureId(nextFixture.id);
    setContent(nextFixture.markdown);
    setLastHostEvent(null);
    setHostEventVisible(false);
  };

  const showHostEvent = (event: PlaygroundHostEvent) => {
    setLastHostEvent(event);
    setHostEventVisible(true);
  };

  const clearHostEvent = () => {
    setHostEventVisible(false);
  };

  const handleUserMentioned = (event: UserMentionEvent) => {
    showHostEvent({
      detail: event.lineMarkdown || "(empty)",
      fields: [
        ["userId", event.userId],
        ["line", event.lineNumber],
      ],
      title: "User mentioned",
    });
  };

  const handleCommentChanged = (change: CommentChange) => {
    const fields: PlaygroundHostEvent["fields"] = [["thread", change.threadIndex]];
    if (change.kind !== "deleted") {
      fields.push(["mentions", change.mentionedUserIds.length]);
    }

    showHostEvent({
      detail: change.comment.body || "(empty)",
      fields,
      title: formatCommentEventTitle(change.kind),
    });
  };

  return (
    <main className="grid h-screen grid-rows-[auto_max-content_minmax(0,1fr)] gap-0 pt-[max(1rem,env(safe-area-inset-top))] pr-[max(1.5rem,env(safe-area-inset-right))] pb-[max(1.5rem,env(safe-area-inset-bottom))] pl-[max(1.5rem,env(safe-area-inset-left))]">
      <header className="mb-4 flex flex-nowrap items-start justify-between gap-4 max-[700px]:portrait:flex-wrap">
        <h1 className="m-0 text-[2em] font-bold">Documint Playground</h1>

        <div className="relative flex flex-wrap items-center justify-end gap-[0.7rem] max-[700px]:portrait:w-full max-[700px]:portrait:justify-start">
          <label className="font-controls grid gap-[0.35rem]">
            <select
              aria-label="Select markdown fixture"
              className="font-controls w-full rounded-xl border border-border/[0.14] bg-background/[0.9] px-3 py-2"
              onChange={(event) => handleFixtureChange(event.target.value)}
              value={fixtureId}
            >
              {fixtureOptions.map((fixture) => (
                <option key={fixture.id} value={fixture.id}>
                  {fixture.label}
                </option>
              ))}
            </select>
          </label>

          <ThemePopover onThemeIdChange={setThemeId} themeId={themeId} />

          <UsersPopover
            content={content}
            onPresenceChange={setPresence}
            onUsersChange={setUsers}
            resetKey={fixtureId}
          />

          {/* Live input-event log; gated so it ships with `bun run dev`
              but not with the deployable demo (`bun run build:playground`). */}
          {process.env.NODE_ENV !== "production" ? <DiagnosticsPopover /> : null}
        </div>
      </header>

      <HostEventPanel
        event={lastHostEvent}
        onClear={clearHostEvent}
        onHidden={() => setLastHostEvent(null)}
        visible={hostEventVisible}
      />

      <section className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-6 portrait:grid-cols-[minmax(0,1fr)]">
        <div className="grid h-full min-h-0 min-w-0">
          <div className={fixtureSurfaceClassName}>
            <Documint
              actions={actions}
              content={content}
              onCommentChanged={handleCommentChanged}
              onContentChanged={setContent}
              onUserMentioned={handleUserMentioned}
              theme={activeTheme ?? undefined}
              users={users}
              presence={presence}
              storage={storage}
              decorations={playgroundDecorations}
            />
          </div>
        </div>

        <div className="grid h-full min-h-0 min-w-0 max-[700px]:portrait:hidden">
          <div className={fixtureSurfaceClassName}>
            <textarea
              aria-label="Markdown source"
              className="font-code h-full min-h-full w-full resize-y rounded-none border-0 bg-background/[0.9] p-4 text-[0.95rem] leading-[1.55]"
              onChange={(event) => setContent(event.target.value)}
              spellCheck={false}
              value={content}
            />
          </div>
        </div>
      </section>
    </main>
  );
}

function HostEventPanel({
  event,
  onClear,
  onHidden,
  visible,
}: {
  event: PlaygroundHostEvent | null;
  onClear: () => void;
  onHidden: () => void;
  visible: boolean;
}) {
  return (
    <section
      aria-live="polite"
      className={`min-w-0 self-start overflow-hidden transition-[max-height,margin-bottom] duration-[180ms] ease-in-out ${
        visible ? "mb-4 max-h-[min(18rem,45vh)]" : "mb-0 max-h-0"
      }`}
      onTransitionEnd={(transitionEvent) => {
        if (transitionEvent.propertyName === "max-height" && !visible) {
          onHidden();
        }
      }}
    >
      <div className="min-w-0">
        {event ? (
          <div className="font-controls grid min-w-0 translate-y-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-3 rounded-xl border border-border/[0.08] bg-background/[0.82] px-3 py-[0.55rem] text-[0.85rem] opacity-100 transition-[opacity,transform] duration-[160ms] ease-in-out starting:translate-y-[-0.65rem] starting:opacity-0">
            <div className="flex min-w-0 flex-wrap items-center gap-[0.45rem]">
              <span className="flex-none font-semibold">{event.title}</span>
              {event.fields.map(([key, value]) => (
                <code className={hostEventCodeClassName} key={key}>
                  {key}={value}
                </code>
              ))}
              <code className={`${hostEventCodeClassName} min-w-0 flex-[1_1_18rem]`}>
                {event.detail}
              </code>
            </div>
            <button
              aria-label="Clear host event"
              className="inline-flex h-[1.7rem] w-[1.7rem] cursor-pointer items-center justify-center rounded-full border border-border/[0.14] bg-background/[0.9] p-0 text-muted transition-colors duration-[140ms] hover:bg-border/[0.06] hover:text-inherit"
              onClick={onClear}
              type="button"
            >
              <X aria-hidden size={16} strokeWidth={2} />
            </button>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function formatCommentEventTitle(kind: CommentChange["kind"]): string {
  switch (kind) {
    case "added":
      return "Comment added";
    case "edited":
      return "Comment edited";
    case "deleted":
      return "Comment deleted";
  }
}
