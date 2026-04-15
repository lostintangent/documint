import { useState } from "react";
import {
  Documint,
  darkTheme,  
  lightTheme,
  midnightTheme,
  mintTheme,
  type EditorTheme,
} from "documint";

const sampleMarkdown = `# Sample Document

This editor stays rendered until you activate a local region.

Use *emphasis*, **strong text**, ~~strikethrough~~, and [links](https://example.com) inside the active span.

| Block | Status | Width | Notes |
| :---- | :----- | ----: | :---- |
| Heading | stable | 640 | stays semantic |
| Table | active | 320 | edits locally |
| Comments | anchored | 3 | remain durable |

- one
- two
- three
`;

const nestedListTortureMarkdown = `# Nested List Torture

- alpha
  - beta
    - [ ] task child
    - [x] shipped child
  - gamma
- delta

1. ordered root
   1. nested ordered
   2. nested ordered two
      - mixed bullet
      - mixed bullet two
2. ordered tail
`;

const blockquoteTransitionMarkdown = `# Blockquote And List Transitions

> quoted intro
>
> - [ ] task in quote
> - nested list transition
>
> closing line

After the quote, keep writing in a paragraph.

---

- start in a list
- backspace at block start to lift out
`;

const longStructuralMarkdown = `# Long Structural Editing

${Array.from({ length: 14 }, (_, index) => {
  const section = index + 1;

  return `## Section ${section}

Paragraph ${section} should stay stable while list structure changes around it.

- bullet ${section}.1
- bullet ${section}.2
  - nested ${section}.2.a
  - nested ${section}.2.b
- [ ] task ${section}.3

> quote ${section}
>
> 1. ordered ${section}.a
> 2. ordered ${section}.b
`;
}).join("\n")}`;

const richCodeMarkdown = `# Rich Code Blocks

\`\`\`ts title=editor-state.ts
export function createEditorState() {
  return "stable";
}
\`\`\`

Paragraph between code fences.

\`\`\`json
{
  "stage": 5,
  "feature": "rich-blocks"
}
\`\`\`
`;

const richImagesMarkdown = `# Rich Images

Inline images stay semantic while rendering like real content.

![Editor shell](https://dummyimage.com/960x540/0f172a/f8fafc.png&text=Editor+Shell "Wide host")
![Narrow host](https://dummyimage.com/640x360/1e293b/e2e8f0.png&text=Narrow+Host "Constrained width")
![Diagnostics](https://dummyimage.com/720x360/0f766e/f0fdfa.png&text=Diagnostics)
`;

const richTablesMarkdown = `# Rich Tables

| Layer | Narrow host | Wide host | Notes |
| :---- | :---------- | --------: | :---- |
| Editor | stable | 640 | keeps selection intact |
| Table | scrolls | 960 | preserves GFM alignment |
| Images | wraps inline | 720 | keeps alt/title metadata |
`;

const richMixedMarkdown = `# Mixed Rich Content

Lead paragraph before rich content.

\`\`\`ts title=commands.ts
export const enter = "splitStructuralBlock";
\`\`\`

| Surface | Behavior | Width |
| :------ | :------- | ----: |
| code | local activation | 320 |
| table | horizontal overflow | 280 |

Paragraph with ![Inline preview](https://example.com/inline-preview.png "Host-fit") after the table.

> A blockquote after rich content should still feel normal.

- [ ] task after table
- bullet after image
`;

const reviewThreadsMarkdown = `# Review Surface

The review surface keeps comment anchors durable across edits and markdown reloads.

- List feedback should stay attached during structural edits.
- Secondary bullet remains unannotated.

| Area         | Note                                         |
| ------------ | -------------------------------------------- |
| Review queue | Table cell anchors should stay attached too. |

:::documint-comments
\`\`\`json
{
  "threads": [
    {
      "quote": "review surface",
      "anchor": {
        "prefix": "The ",
        "suffix": " keeps comment anchors d"
      },
      "comments": [
        {
          "body": "Focus the durable anchor claim.",
          "updatedAt": "2026-04-05T12:00:00.000Z"
        }
      ]
    },
    {
      "quote": "List feedback",
      "anchor": {
        "suffix": " should stay attached du"
      },
      "comments": [
        {
          "body": "Verify list-item comments survive structural edits.",
          "updatedAt": "2026-04-05T12:02:00.000Z"
        }
      ]
    },
    {
      "quote": "Table cell anchors",
      "anchor": {
        "kind": "tableCell",
        "suffix": " should stay attached to"
      },
      "comments": [
        {
          "body": "Confirm table-cell comments remain sticky too.",
          "updatedAt": "2026-04-05T12:04:00.000Z"
        }
      ]
    }
  ]
}
\`\`\`
:::
`;

const overlappingCommentsMarkdown = `# Overlapping Threads

The review surface keeps comment anchors durable and reviewable for overlap tests.

:::documint-comments
\`\`\`json
{
  "threads": [
    {
      "quote": "review surface",
      "anchor": {
        "prefix": "The ",
        "suffix": " keeps comment anchors d"
      },
      "comments": [
        {
          "body": "Overlap A",
          "updatedAt": "2026-04-05T12:00:00.000Z"
        }
      ]
    },
    {
      "quote": "surface keeps",
      "anchor": {
        "prefix": "The review ",
        "suffix": " comment anchors durable"
      },
      "comments": [
        {
          "body": "Overlap B",
          "updatedAt": "2026-04-05T12:01:00.000Z"
        }
      ]
    }
  ]
}
\`\`\`
:::
`;

const fixtureOptions = [
  {
    id: "sample",
    label: "Sample fixture",
    markdown: sampleMarkdown,
  },
  {
    id: "article",
    label: "Article fixture",
    markdown: `# Demo Host

Resize this shell and confirm the editor keeps its state and local affordances.

## Narrow host

The editor width should follow the host container, not the window.

1. Click into a heading
2. Move into emphasized text
3. Paste multiple lines
`,
  },
  {
    id: "nested-lists",
    label: "Nested list torture",
    markdown: nestedListTortureMarkdown,
  },
  {
    id: "blockquote-transitions",
    label: "Blockquote transitions",
    markdown: blockquoteTransitionMarkdown,
  },
  {
    id: "long-structural",
    label: "Long structural doc",
    markdown: longStructuralMarkdown,
  },
  {
    id: "rich-code",
    label: "Code-heavy rich doc",
    markdown: richCodeMarkdown,
  },
  {
    id: "rich-images",
    label: "Image-rich doc",
    markdown: richImagesMarkdown,
  },
  {
    id: "rich-tables",
    label: "Wide-table doc",
    markdown: richTablesMarkdown,
  },
  {
    id: "rich-mixed",
    label: "Mixed rich doc",
    markdown: richMixedMarkdown,
  },
  {
    id: "review-threads",
    label: "Seeded review doc",
    markdown: reviewThreadsMarkdown,
  },
  {
    id: "overlap-threads",
    label: "Overlapping threads",
    markdown: overlappingCommentsMarkdown,
  },
];

const sunriseTheme: EditorTheme = {
  ...lightTheme,
  activeBlockBackground: "rgba(251, 191, 36, 0.18)",
  activeBlockFlash: "rgba(249, 115, 22, 0.3)",
  blockquoteRuleActive: "rgba(249, 115, 22, 0.34)",
  blockquoteRule: "rgba(194, 65, 12, 0.24)",
  caret: "#7c2d12",
  codeBackground: "#431407",
  codeText: "#ffedd5",
  commentHighlight: "rgba(253, 186, 116, 0.34)",
  commentHighlightActive: "#ea580c",
  commentHighlightResolved: "#fde68a",
  commentHighlightResolvedActive: "#f59e0b",
  insertHighlightText: "#ea580c",
  headingText: "#7c2d12",
  inlineCodeBackground: "rgba(194, 65, 12, 0.08)",
  inlineCodeText: "#9a3412",
  leafButtonBackground: "rgba(194, 65, 12, 0.08)",
  leafButtonBorder: "rgba(234, 88, 12, 0.32)",
  leafButtonText: "#7c2d12",
  leafAccent: "#ea580c",
  leafBackground: "#fff7ed",
  leafBorder: "rgba(234, 88, 12, 0.24)",
  leafSecondaryText: "#9a3412",
  leafResolvedBackground: "#fde68a",
  leafResolvedBorder: "#f59e0b",
  leafText: "#7c2d12",
  linkText: "#c2410c",
  paragraphText: "#7c2d12",
  blockquoteText: "#9a3412",
  selectionBackground: "rgba(251, 146, 60, 0.24)",
  selectionHandleBackground: "#fff7ed",
  selectionHandleBorder: "#ea580c",
  background: "#fff7ed",
  tableBodyBackground: "rgba(255, 247, 237, 0.96)",
  tableBorder: "rgba(234, 88, 12, 0.24)",
  tableHeaderBackground: "rgba(255, 237, 213, 0.96)",
};

const themeOptions = [
  {
    id: "light",
    label: "Light theme",
    theme: lightTheme,
  },
  {
    id: "dark",
    label: "Dark theme",
    theme: darkTheme,
  },
  {
    id: "sunrise",
    label: "Sunrise theme",
    theme: sunriseTheme,
  },
  {
    id: "mint",
    label: "Mint theme",
    theme: mintTheme,
  },
  {
    id: "midnight",
    label: "Midnight theme",
    theme: midnightTheme,
  },
] as const;

export function Playground() {
  const [fixtureId, setFixtureId] = useState(fixtureOptions[0].id);
  const [content, setContent] = useState(fixtureOptions[0].markdown);
  const [themeId, setThemeId] = useState<string>(themeOptions[0].id);
  const activeTheme =
    themeOptions.find((option) => option.id === themeId)?.theme ?? lightTheme;

  return (
    <main className="playground-shell">
      <header className="playground-header">
        <h1>Documint Playground</h1>

        <div className="playground-controls">
          <label className="fixture-picker">
            <select
              aria-label="Select markdown fixture"
              onChange={(event) => {
                const nextFixture = fixtureOptions.find(
                  (candidate) => candidate.id === event.target.value,
                );

                if (!nextFixture) {
                  return;
                }

                setFixtureId(nextFixture.id);
                setContent(nextFixture.markdown);
              }}
              value={fixtureId}
            >
              {fixtureOptions.map((fixture) => (
                <option key={fixture.id} value={fixture.id}>
                  {fixture.label}
                </option>
              ))}
            </select>
          </label>

          <label className="fixture-picker">
            <select
              aria-label="Select editor theme"
              onChange={(event) => setThemeId(event.target.value)}
              value={themeId}
            >
              {themeOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </header>

      <section className="playground-grid">
        <div className="host-panel">
          <div className="host-card">
            <Documint
              content={content}
              onContentChange={(nextContent) => {
                setContent(nextContent);
              }}
              theme={activeTheme}
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
