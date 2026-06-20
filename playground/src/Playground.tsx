import { useMemo, useState } from "react";
import {
  Documint,
  darkTheme,
  lightTheme,
  type CommentChange,
  type DocumentPresence,
  type DocumentUser,
  type DocumintActions,
  type DocumintDecoration,
  type DocumintStorage,
  type DocumintTheme,
  type UserMentionEvent,
  lucideResourceIcon,
} from "documint";
import { Hand } from "lucide-react";
import dynamicIconImports from "lucide-react/dynamicIconImports";
import { HostEventPanel } from "./components/HostEventPanel";
import { DiagnosticsPopover } from "./components/popovers/DiagnosticsPopover";
import { FrameDebugOverlay } from "./components/FrameDebugOverlay";
import { UsersPopover } from "./components/popovers/UsersPopover";
import { ThemePopover } from "./components/popovers/ThemePopover";
import {
  createCommentHostEvent,
  createUserMentionHostEvent,
  type PlaygroundHostEvent,
} from "./lib/events";
import {
  fixtureOptions,
  getThemeOption,
  grammars,
  slowSampleImagePath,
  slowSampleImageSource,
  themeOptions,
} from "./lib/data";
import { effects } from "./lib/effects";

// In-memory storage for reading/writing pasted images. Hosts in the wild would write to
// disk, S3, etc.; the playground keeps blobs in a Map so paste-to-render
// works without leaving the browser tab.
function createInMemoryStorage(): DocumintStorage {
  const files = new Map<string, Blob>();

  return {
    async readFile(path) {
      if (path === slowSampleImagePath) {
        await delay(10000);
        const cached = files.get(path);
        if (cached) return cached;

        const response = await fetch(slowSampleImageSource);
        if (!response.ok) return null;

        const blob = await response.blob();
        files.set(path, blob);
        return blob;
      }

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

function delay(ms: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, ms));
}

const storage = createInMemoryStorage();

const demoUser: DocumentUser = {
  id: "demo",
  username: "demo",
};

const decorations: readonly DocumintDecoration[] = [
  { backgroundColor: "#fde047", pattern: /\bTODO\b/g },
  { backgroundColor: "#38bdf8", pulse: true, color: "#082f49", pattern: /\blesson\b/g },
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

const [
  { __iconNode: themeIconNode },
  { __iconNode: recordingIconNode },
  { __iconNode: noteIconNode },
] = await Promise.all([
  dynamicIconImports.settings(),
  dynamicIconImports.mic(),
  dynamicIconImports["sticky-note"](),
]);

const protocols = {
  "playground:": {
    icon: lucideResourceIcon(themeIconNode),
    label: "Playground",
  },
  "demo-resource:": {
    icon: lucideResourceIcon(recordingIconNode),
    label: "Demo resource",
  },
  "demo-note:": {
    icon: lucideResourceIcon(noteIconNode),
    label: "Demo note",
  },
};

const activeResources = new Set(["demo-resource://recording/live"]);

const fixtureSurfaceClassName =
  "grid h-full min-h-0 min-w-0 grid-rows-1 overflow-hidden rounded-2xl border border-border/10 bg-background/80 max-sm:portrait:h-auto";

export function Playground() {
  const [content, setContent] = useState<string>(fixtureOptions[0].markdown);
  const [sourceContent, setSourceContent] = useState<string>(fixtureOptions[0].markdown);
  const [fixtureId, setFixtureId] = useState<string>(fixtureOptions[0].id);
  const [themeId, setThemeId] = useState<string>(themeOptions[0].id);
  const [themePopoverOpen, setThemePopoverOpen] = useState(false);
  const [customEffectsEnabled, setCustomEffectsEnabled] = useState(false);
  const [showDiffs, setShowDiffs] = useState(true);
  const [fontSize, setFontSize] = useState<number>(16);

  const [users, setUsers] = useState<DocumentUser[]>([]);
  const [presence, setPresence] = useState<DocumentPresence[]>([]);

  const [lastHostEvent, setLastHostEvent] = useState<PlaygroundHostEvent | null>(null);
  const [hostEventVisible, setHostEventVisible] = useState(false);
  const [frameDebugEnabled, setFrameDebugEnabled] = useState(false);

  const { theme: activeTheme } = getThemeOption(themeId);

  // Merge the playground's `fontSize` knob into whichever theme is selected.
  // For "system theme" (activeTheme = null), pass a light/dark pair sourced
  // from the bundled themes so the embedder layer still does its own system
  // color-scheme matching while honoring our fontSize choice. Memoize so
  // Documint sees a stable theme object across renders that don't change
  // either input.
  const documintTheme = useMemo<DocumintTheme>(() => {
    if (!activeTheme) {
      return {
        dark: { ...darkTheme, fontSize },
        light: { ...lightTheme, fontSize },
      };
    }
    return { ...activeTheme, fontSize };
  }, [activeTheme, fontSize]);

  const mentionUsers = users.some((user) => user.id === demoUser.id) ? users : [demoUser, ...users];

  const handleFixtureChange = (nextFixtureId: string) => {
    const nextFixture = fixtureOptions.find((candidate) => candidate.id === nextFixtureId);
    if (!nextFixture) return;

    setFixtureId(nextFixture.id);
    setContent(nextFixture.markdown);
    setSourceContent(nextFixture.markdown);

    setLastHostEvent(null);
    setHostEventVisible(false);
  };

  const handleMarkdownSourceChanged = (nextContent: string) => {
    setContent(nextContent);
    setSourceContent(nextContent);
  };

  const showHostEvent = (event: PlaygroundHostEvent) => {
    setLastHostEvent(event);
    setHostEventVisible(true);
  };

  const clearHostEvent = () => setHostEventVisible(false);

  const handleUserMentioned = (event: UserMentionEvent) => {
    showHostEvent(createUserMentionHostEvent(event));
  };

  const handleCommentChanged = (change: CommentChange) => {
    showHostEvent(createCommentHostEvent(change));
  };

  return (
    <main className="grid h-screen grid-rows-[auto_max-content_minmax(0,1fr)] page-padding">
      <header className="mb-4 flex items-start justify-between gap-4 max-sm:portrait:flex-wrap">
        <h1 className="m-0 text-3xl font-bold">Documint Playground</h1>

        <div className="relative flex flex-wrap items-center justify-end gap-3 max-sm:portrait:w-full max-sm:portrait:justify-start">
          <label className="font-controls grid gap-1.5">
            <select
              aria-label="Select markdown fixture"
              className="font-controls w-full rounded-xl border border-border/15 bg-background/90 px-3 py-2"
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

          <ThemePopover
            customEffectsEnabled={customEffectsEnabled}
            fontSize={fontSize}
            onCustomEffectsEnabledChange={setCustomEffectsEnabled}
            onFontSizeChange={setFontSize}
            onOpenChange={setThemePopoverOpen}
            onShowDiffsChange={setShowDiffs}
            onThemeIdChange={setThemeId}
            open={themePopoverOpen}
            showDiffs={showDiffs}
            themeId={themeId}
          />

          <UsersPopover
            key={`${fixtureId}-users`}
            content={sourceContent}
            onPresenceChange={setPresence}
            onUsersChange={setUsers}
          />

          {/* Live input-event log; gated so it ships with `bun run dev`
              but not with the deployable demo (`bun run build:playground`). */}
          {process.env.NODE_ENV !== "production" ? (
            <DiagnosticsPopover
              frameDebugEnabled={frameDebugEnabled}
              onFrameDebugEnabledChange={setFrameDebugEnabled}
            />
          ) : null}
        </div>
      </header>

      <HostEventPanel
        event={lastHostEvent}
        onClear={clearHostEvent}
        onHidden={() => setLastHostEvent(null)}
        visible={hostEventVisible}
      />

      <section className="grid h-full min-h-0 grid-cols-2 gap-6 portrait:grid-cols-1">
        <div className="grid h-full min-h-0 min-w-0">
          <div className={fixtureSurfaceClassName}>
            <Documint
              content={content}
              effects={customEffectsEnabled ? effects : undefined}
              theme={documintTheme}
              users={mentionUsers}
              presence={presence}
              protocols={protocols}
              resources={activeResources}
              showDiffs={showDiffs}
              storage={storage}
              actions={actions}
              decorations={decorations}
              grammars={grammars}
              onCommentChanged={handleCommentChanged}
              onContentChanged={setSourceContent}
              onResourceOpened={(resource) => {
                if (resource.protocol === "playground:" && resource.url === "playground:/theme") {
                  setThemePopoverOpen(true);
                  return;
                }

                window.alert(`Open resource: ${resource.url}`);
              }}
              onResourcesRequested={() => {}}
              onUserMentioned={handleUserMentioned}
            />
          </div>
        </div>

        <div className="grid h-full min-h-0 min-w-0 max-sm:portrait:hidden">
          <div className={fixtureSurfaceClassName}>
            <textarea
              aria-label="Markdown source"
              className="font-code h-full min-h-full w-full resize-y rounded-none border-0 bg-background/90 p-4 text-base leading-normal"
              onChange={(event) => handleMarkdownSourceChanged(event.target.value)}
              spellCheck={false}
              value={sourceContent}
            />
          </div>
        </div>
      </section>
      {process.env.NODE_ENV !== "production" ? (
        <FrameDebugOverlay enabled={frameDebugEnabled} />
      ) : null}
    </main>
  );
}
