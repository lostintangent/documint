import { useCallback, useState } from "react";
import { Documint, type DocumintState, type MentionTriggerEvent, type Presence } from "documint";
import { fixtureOptions, getThemeOption, sampleMentionSuggestions, themeOptions } from "./data";
import { PresencePopover } from "./popovers/PresencePopover";
import { ThemePopover } from "./popovers/ThemePopover";

type StatusBarState = {
  activeBlockType: string | null;
  characterCount: number;
  commentThreadCount: number;
  resolvedCommentCount: number;
  selectionFrom: number;
  selectionTo: number;
};

const defaultStatus: StatusBarState = {
  activeBlockType: null,
  characterCount: 0,
  commentThreadCount: 0,
  resolvedCommentCount: 0,
  selectionFrom: 0,
  selectionTo: 0,
};

export function Playground() {
  const [fixtureId, setFixtureId] = useState<string>(fixtureOptions[0].id);
  const [content, setContent] = useState<string>(fixtureOptions[0].markdown);
  const [themeId, setThemeId] = useState<string>(themeOptions[0].id);
  const [presence, setPresence] = useState<Presence[]>([]);
  const [status, setStatus] = useState<StatusBarState>(defaultStatus);
  const [lastMention, setLastMention] = useState<string | null>(null);

  const activeThemeOption = getThemeOption(themeId);
  const activeTheme = activeThemeOption.theme;

  const handleFixtureChange = (nextFixtureId: string) => {
    const nextFixture = fixtureOptions.find((candidate) => candidate.id === nextFixtureId);

    if (!nextFixture) {
      return;
    }

    setFixtureId(nextFixture.id);
    setContent(nextFixture.markdown);
    setLastMention(null);
  };

  const handleThemeChange = (nextThemeId: string) => {
    setThemeId(nextThemeId);
  };

  const handleContentChange = (nextContent: string) => {
    setContent(nextContent);
  };

  const handleStateChange = useCallback((state: DocumintState) => {
    setStatus({
      activeBlockType: state.activeBlockType,
      characterCount: state.characterCount,
      commentThreadCount: state.commentThreadCount,
      resolvedCommentCount: state.resolvedCommentCount,
      selectionFrom: state.selectionFrom,
      selectionTo: state.selectionTo,
    });
  }, []);

  const handleMentionTriggered = useCallback((event: MentionTriggerEvent) => {
    const label = event.handles.map((h) => `@${h}`).join(", ");
    setLastMention(label);
    console.log("[playground] mention triggered:", event);
  }, []);

  const hasSelection = status.selectionFrom !== status.selectionTo;

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

          <PresencePopover content={content} onPresenceChange={setPresence} resetKey={fixtureId} />
        </div>
      </header>

      <div className="playground-status-bar">
        <span className="status-item">
          {status.activeBlockType ?? "—"}
        </span>

        <span className="status-separator" aria-hidden="true" />

        <span className={`status-item${hasSelection ? " has-selection" : ""}`}>
          {hasSelection
            ? `sel ${status.selectionFrom}–${status.selectionTo}`
            : `pos ${status.selectionFrom}`}
        </span>

        <span className="status-separator" aria-hidden="true" />

        <span className="status-item">
          {status.characterCount} chars
        </span>

        {status.commentThreadCount > 0 && (
          <>
            <span className="status-separator" aria-hidden="true" />
            <span className="status-item">
              {status.commentThreadCount} thread{status.commentThreadCount !== 1 ? "s" : ""}
              {status.resolvedCommentCount > 0 && (
                <> · {status.resolvedCommentCount} resolved</>
              )}
            </span>
          </>
        )}

        {lastMention && (
          <>
            <span className="status-separator" aria-hidden="true" />
            <span className="status-item status-mention">
              mentioned {lastMention}
            </span>
          </>
        )}
      </div>

      <section className="playground-grid">
        <div className="host-panel">
          <div className="host-card">
            <Documint
              content={content}
              mentionSuggestions={sampleMentionSuggestions}
              onContentChange={handleContentChange}
              onMentionTriggered={handleMentionTriggered}
              onStateChange={handleStateChange}
              presence={presence}
              theme={activeTheme ?? undefined}
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
