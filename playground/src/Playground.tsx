import { useState } from "react";
import {
  Documint,
  type DocumentPresence,
  type DocumentUser,
  type DocumintStorage,
} from "documint";
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
  };
}

const storage = createInMemoryStorage();

export function Playground() {
  const [content, setContent] = useState<string>(fixtureOptions[0].markdown);

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
  };

  return (
    <main className="playground-shell">
      <header className="playground-header">
        <h1>Documint Playground</h1>

        <div className="playground-controls">
          <label className="fixture-picker">
            <select
              aria-label="Select markdown fixture"
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

      <section className="playground-grid">
        <div className="host-panel">
          <div className="host-card">
            <Documint
              content={content}
              onContentChanged={setContent}
              theme={activeTheme ?? undefined}
              users={users}
              presence={presence}
              storage={storage}
            />
          </div>
        </div>

        <div className="source-panel">
          <div className="source-card">
            <textarea
              aria-label="Markdown source"
              className="source-editor"
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
