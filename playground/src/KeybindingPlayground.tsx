import { useState } from "react";
import { Documint } from "documint";

const sampleMarkdown = `# Editing Keybindings

Click anywhere in this document, then try the shortcuts in the reference panel.

## Move and select by word

Move through alpha, beta, and punctuation. Try selecting several words in either direction.

Unicode words work too: café naïve résumé.

## Format a selection

Select this phrase and toggle strikethrough.

## Delete and undo

Place the caret in this sentence and delete one word backward or forward. Then press Command+Z to restore it.

Word deletion can cross between ordinary paragraphs.

But it stops safely at structural boundaries:

\`\`\`text
Code block content is protected at its edges.
\`\`\`

| Table cell | Another cell |
| ---------- | ------------ |
| alpha beta | gamma delta  |

## Document boundaries

Use the document shortcuts to jump between this heading and the beginning of the page. Hold Shift to select everything along the way.
`;

const shortcuts = [
  { keys: ["⌘", "A"], label: "Select the entire document" },
  { keys: ["⌥", "← / →"], label: "Move backward or forward by word" },
  { keys: ["⌥", "⇧", "← / →"], label: "Select backward or forward by word" },
  { keys: ["⌥", "Delete"], label: "Delete the previous word" },
  { keys: ["⌥", "Fn", "Delete"], label: "Delete the next word" },
  { keys: ["⌘", "Z"], label: "Undo the last edit" },
  { keys: ["⌘", "⇧", "Z"], label: "Redo the last undone edit" },
  { keys: ["⌘", "Y"], label: "Redo the last undone edit" },
  { keys: ["⌘", "⇧", "X"], label: "Toggle strikethrough" },
  { keys: ["⌘", "Home / End"], label: "Move to the document start or end" },
  { keys: ["⌘", "⇧", "Home / End"], label: "Select to the document start or end" },
] as const;

export function KeybindingPlayground() {
  const [currentMarkdown, setCurrentMarkdown] = useState(sampleMarkdown);

  return (
    <main className="page-padding grid h-screen min-h-0 grid-cols-[minmax(0,1fr)_minmax(18rem,24rem)] gap-6 max-md:grid-cols-1 max-md:grid-rows-[minmax(30rem,1fr)_auto]">
      <section className="grid min-h-0 overflow-hidden rounded-2xl border border-border/10 bg-background/90 shadow-xl">
        <Documint content={sampleMarkdown} onContentChanged={setCurrentMarkdown} />
      </section>

      <aside className="font-controls overflow-auto rounded-2xl border border-border/10 bg-background/90 p-6 shadow-xl">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <p className="mb-1 text-sm font-semibold tracking-wide text-accent uppercase">macOS</p>
            <h1 className="m-0 text-2xl font-bold">Editing shortcuts</h1>
          </div>
          <a className="text-sm font-semibold text-accent hover:underline" href="./index.html">
            Full playground
          </a>
        </div>

        <div className="grid gap-3">
          {shortcuts.map((shortcut) => (
            <div
              className="grid gap-2 rounded-xl border border-border/10 bg-slate-50/80 p-3"
              key={shortcut.label}
            >
              <div className="flex flex-wrap gap-1.5" aria-label={shortcut.keys.join(" plus ")}>
                {shortcut.keys.map((key) => (
                  <kbd
                    className="min-w-8 rounded-md border border-slate-300 bg-white px-2 py-1 text-center font-code text-sm shadow-sm"
                    key={key}
                  >
                    {key}
                  </kbd>
                ))}
              </div>
              <span className="text-sm text-muted">{shortcut.label}</span>
            </div>
          ))}
        </div>

        <p className="mt-5 text-sm leading-relaxed text-muted">
          On a full-size keyboard, forward word deletion is Option+Forward Delete. On a Mac laptop,
          Fn+Delete produces Forward Delete.
        </p>

        <details className="mt-5 border-t border-border/10 pt-4">
          <summary className="cursor-pointer text-sm font-semibold text-accent">
            Current markdown
          </summary>
          <pre
            aria-label="Current markdown"
            className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap rounded-xl bg-slate-950 p-3 font-code text-xs text-slate-100"
          >
            {currentMarkdown}
          </pre>
        </details>
      </aside>
    </main>
  );
}
