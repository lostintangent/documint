import { useState } from "react";
import { Documint, type DocumentPresence, type DocumentUser } from "documint";
import { fixtureOptions, getThemeOption, themeOptions } from "./data";
import { DiagnosticsPopover } from "./popovers/DiagnosticsPopover";
import { UsersPopover } from "./popovers/UsersPopover";
import { ThemePopover } from "./popovers/ThemePopover";

export function Playground() {
  const [fixtureId, setFixtureId] = useState<string>(fixtureOptions[0].id);
  const [content, setContent] = useState<string>(fixtureOptions[0].markdown);
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

  const handleThemeChange = (nextThemeId: string) => {
    setThemeId(nextThemeId);
  };

  const handleContentChange = (nextContent: string) => {
    setContent(nextContent);
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

          <ThemePopover onThemeIdChange={handleThemeChange} themeId={themeId} />

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
              onContentChanged={handleContentChange}
              presence={presence}
              theme={activeTheme ?? undefined}
              users={users}
            />
          </div>
        </div>

        <div className="source-panel">
          <div className="source-card">
            <textarea
              aria-label="Markdown source"
              className="source-editor"
              onChange={(event) => handleContentChange(event.target.value)}
              spellCheck={false}
              value={content}
            />
          </div>
        </div>
      </section>
    </main>
  );
}
