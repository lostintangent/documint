import {
  darkTheme,
  lightTheme,
  midnightTheme,
  mintTheme,
  type EditorTheme,
  type MentionSuggestion,
} from "documint";

const sampleMarkdown = `# Sample Document

This sample shows the core Documint editing surface in one short document.

It stays rendered like a document, then turns locally editable when you activate a block or span.

Use *emphasis*, **strong text**, ~~strikethrough~~, <ins>underline</ins>, and [links](https://example.com) inside the active span.

| Block | Status | Width | Notes |
| :---- | :----- | ----: | :---- |
| Heading | stable | 640 | stays semantic |
| Table | active | 320 | edits locally |
| Comments | anchored | 3 | remain durable |

> A sample blockquote should still read naturally in the default fixture.

## Lists

It supports unordered lists for quick notes and simple grouping.

- one
- two
- three

It also supports ordered lists when sequence matters.

1. First ordered step
2. Second ordered step

And it even supports task lists with clickable checkboxes.

- [ ] task one
- [x] task two

:::documint-comments
[
  {
    "quote": "active span",
    "anchor": {
      "prefix": "e, and links inside the ",
      "suffix": "."
    },
    "comments": [
      {
        "body": "Verify the default sample carries one visible comment thread.",
        "updatedAt": "2026-04-17T12:00:00.000Z"
      }
    ]
  }
]
:::
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
[
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
:::
`;

const overlappingCommentsMarkdown = `# Overlapping Threads

The review surface keeps comment anchors durable and reviewable for overlap tests.

:::documint-comments
[
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
:::
`;

export const fixtureOptions = [
  {
    id: "sample",
    label: "Sample fixture",
    markdown: sampleMarkdown,
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
] as const;

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

export const themeOptions = [
  {
    id: "system",
    label: "System theme",
    theme: null,
  },
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

export function getThemeOption(themeId: string) {
  return themeOptions.find((option) => option.id === themeId) ?? themeOptions[0];
}

export const sampleMentionSuggestions: MentionSuggestion[] = [
  { handle: "alice", name: "Alice Chen", color: "#e11d48" },
  { handle: "bob", name: "Bob Martinez", color: "#2563eb" },
  { handle: "carol", name: "Carol Wu", color: "#059669" },
  { handle: "dave", name: "Dave Kim", color: "#7c3aed" },
];
