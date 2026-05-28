import { darkTheme, lightTheme, type EditorTheme } from "documint";

export const slowSampleImagePath = "playground-slow-editor-shell.png";
export const slowSampleImageSource =
  "https://dummyimage.com/960x540/0f172a/f8fafc.png&text=Editor+Shell";

const sampleMarkdown = `# 🎓 Tutorial Document

Welcome to Documint 👋, a canvas-based markdown editor for rich documents with formatting, tables, images, comments, mentions, and custom decorations.

Use the [theme picker](playground:/theme) to see how the editor can be themed in various ways.

As you edit the document, the markdown updates on the right; you can also edit that markdown directly to update the document.

## ✍️ Formatting

Use *emphasis*, **strong text**, ~~strikethrough~~, <ins>underline</ins>, super<sup>script</sup>, \`inline code\`, and [links](https://example.com) inline.

Select text and paste a URL to turn the selection into a link.

---

Use three dashes to insert a horizontal divider, as seen above.

Hit Shift+Enter to insert a soft line break<br>that wraps to a new line without starting a new block.

## 📊 Tables

| Block | Status | Width | Notes |
| :---- | :----- | ----: | :---- |
| Heading | stable | 640 | stays semantic |
| Table | active | 320 | edits locally |
| Comments | anchored | 3 | remain durable |

## ✅ Lists

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

## 🖼️ Images

Inline images stay semantic while rendering like real content.

Select and resize an image below with the handles, or paste an image to insert a new one.

![Editor shell](${slowSampleImagePath} "Wide host")
![Narrow host](https://dummyimage.com/640x360/1e293b/e2e8f0.png&text=Narrow+Host "Constrained width")
![Diagnostics](https://dummyimage.com/720x360/0f766e/f0fdfa.png&text=Diagnostics)

## 💬 Block Quotes

> A sample blockquote should still read naturally in the default fixture.
>
> Block quotes can contain multiple lines while remaining editable as structured content.

## 📝 Comments

Comments stay anchored to quoted text as the document changes.

Select text to add a new comment, or use an existing thread to add replies.

- List feedback should stay attached during structural edits.
- Secondary bullet remains unannotated.

| Area         | Note                                         |
| ------------ | -------------------------------------------- |
| Review queue | Table cell anchors should stay attached too. |

## 🙋 Mentions

At-mention available users directly in the document, like @[demo](demo).

Use the Users control in the upper right to add more mentionable users while testing the playground.

## 🔗 Resources

Hosts can register custom link protocols and render those links as live resource pills.

Try the active [Recording session](demo-resource://recording/live) resource and the inactive [Planning note](demo-note://note/complete) resource.

## 🎨 Decorations

Hosts can define decorations from text patterns and use them to apply custom foreground colors, background colors, or pulse animations.

- one (1)
- two (2)
- three (3)

The numbered markers above use a foreground color decoration, while TODO uses a highlighted background.

The word lesson uses a pulsing decoration so the playground can exercise paint-only animation without changing editor state.

## 🌳 Code Blocks

Use fenced code blocks for source snippets, configuration, and markdown examples that should stay literal.

\`\`\`text
        &&& &&&&& &&&
     &&&&&&&&&&&&&&&&&&&
   &&&&&&&&&&&&&&&&&&&&&&&
  &&&&&&&&&&&&&&&&&&&&&&&&&
   &&&&&&&&&&&&&&&&&&&&&&&
     &&&&&&&&&&&&&&&&&&&
          &&& ||| &&&
              |||
              |||
          ____|||____
\`\`\`

Markdown can be shown literally inside a code fence:

\`\`\`markdown
## Release notes

- Add a concise summary.
- Include \`inline code\` when a command or symbol matters.
\`\`\`

:::documint-comments
[
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

const scrollingTestMarkdown = createRealisticLongMarkdown(80, "Scrolling Test");

export const fixtureOptions = [
  {
    id: "sample",
    label: "Tutorial document",
    markdown: sampleMarkdown,
  },
  {
    id: "blank",
    label: "Blank document",
    markdown: "",
  },
  {
    id: "scrolling",
    label: "Scrolling test",
    markdown: scrollingTestMarkdown,
  },
] as const;

function createRealisticLongMarkdown(sectionCount: number, title: string) {
  const sections = Array.from({ length: sectionCount }, (_, index) => {
    const sectionNumber = index + 1;
    const list =
      sectionNumber % 3 === 0
        ? [
            "",
            "- Capture the current behavior in a short note.",
            "- Follow up with the next concrete decision.",
            "- Keep enough context nearby that future edits remain clear.",
          ]
        : [];
    const quote =
      sectionNumber % 7 === 0
        ? [
            "",
            "> This note is here to keep block quote layout represented without turning the fixture into a stress test.",
          ]
        : [];
    const table =
      sectionNumber % 15 === 0
        ? [
            "",
            "| Topic | Owner | Status |",
            "| ----- | ----- | ------ |",
            `| Section ${sectionNumber} | Demo | Active |`,
            "| Follow-up | Demo | Open |",
          ]
        : [];

    return [
      `## Section ${sectionNumber}`,
      "",
      `This section is intentionally ordinary prose. It has enough text to wrap in the editor, but it avoids adversarial character patterns so it behaves like a realistic note, proposal, or design document.`,
      "",
      `The second paragraph adds a little more body copy for scrolling and editing tests. It mentions TODO and lesson so the playground decorations still appear in long documents.`,
      ...list,
      ...quote,
      ...table,
    ].join("\n");
  });

  return [
    `# ${title}`,
    "",
    "Use this fixture to test realistic long-document scrolling, editing, decorations, and occasional structured blocks.",
    "",
    ...sections,
    "",
  ].join("\n");
}

const sunriseTheme: EditorTheme = {
  ...lightTheme,
  activeBlockBackground: "rgba(251, 191, 36, 0.18)",
  activeBlockFlash: "rgba(249, 115, 22, 0.3)",
  blockquoteRuleActive: "rgba(249, 115, 22, 0.34)",
  blockquoteRule: "rgba(194, 65, 12, 0.24)",
  codeBackground: "#431407",
  codeText: "#ffedd5",
  commentHighlight: "rgba(253, 186, 116, 0.34)",
  commentHighlightActive: "#ea580c",
  commentHighlightResolved: "#fde68a",
  commentHighlightResolvedActive: "#f59e0b",
  insertHighlightText: "#ea580c",
  inlineCodeBackground: "rgba(194, 65, 12, 0.08)",
  inlineCodeText: "#9a3412",
  leafAccent: "#ea580c",
  leafBorder: "rgba(234, 88, 12, 0.24)",
  leafInputBackground: "rgba(194, 65, 12, 0.08)",
  leafSecondaryText: "#9a3412",
  leafResolvedBackground: "#fde68a",
  leafResolvedBorder: "#f59e0b",
  linkText: "#c2410c",
  blockquoteText: "#9a3412",
  text: "#7c2d12",
  selectionBackground: "rgba(251, 146, 60, 0.24)",
  selectionHandleBackground: "#fff7ed",
  selectionHandleBorder: "#ea580c",
  background: "#fff7ed",
  tableBodyBackground: "rgba(255, 247, 237, 0.96)",
  tableBorder: "rgba(234, 88, 12, 0.24)",
  tableHeaderBackground: "rgba(255, 237, 213, 0.96)",
};

const mintTheme: EditorTheme = {
  ...lightTheme,
  activeBlockBackground: "rgba(16, 185, 129, 0.14)",
  activeBlockFlash: "rgba(16, 185, 129, 0.26)",
  background: "#f3fbf6",
  blockquoteRule: "rgba(5, 150, 105, 0.22)",
  blockquoteRuleActive: "rgba(6, 95, 70, 0.38)",
  blockquoteText: "#166534",
  codeBackground: "#052e16",
  codeText: "#dcfce7",
  commentHighlight: "rgba(52, 211, 153, 0.26)",
  commentHighlightActive: "#10b981",
  commentHighlightResolved: "rgba(187, 247, 208, 0.96)",
  commentHighlightResolvedActive: "#059669",
  headingRule: "rgba(20, 83, 45, 0.18)",
  inlineCodeBackground: "rgba(20, 83, 45, 0.08)",
  inlineCodeText: "#166534",
  insertHighlightText: "#10b981",
  leafAccent: "#059669",
  leafBorder: "rgba(22, 163, 74, 0.24)",
  leafInputBackground: "rgba(20, 83, 45, 0.08)",
  leafResolvedBackground: "#d1fae5",
  leafResolvedBorder: "#10b981",
  leafSecondaryText: "#166534",
  leafShadow: "0 14px 40px rgba(20, 83, 45, 0.14)",
  linkText: "#047857",
  selectionBackground: "rgba(52, 211, 153, 0.24)",
  selectionHandleBackground: "#f3fbf6",
  selectionHandleBorder: "#059669",
  tableBodyBackground: "rgba(243, 251, 246, 0.96)",
  tableBorder: "rgba(22, 163, 74, 0.24)",
  tableHeaderBackground: "rgba(220, 252, 231, 0.96)",
  text: "#14532d",
};

const midnightTheme: EditorTheme = {
  ...darkTheme,
  activeBlockBackground: "rgba(168, 85, 247, 0.16)",
  activeBlockFlash: "rgba(243, 232, 255, 0.13)",
  blockquoteRule: "rgba(196, 181, 253, 0.34)",
  blockquoteRuleActive: "rgba(216, 180, 254, 0.44)",
  caret: "#f5f3ff",
  codeBackground: "#1e1b4b",
  codeText: "#ede9fe",
  commentHighlight: "rgba(167, 139, 250, 0.28)",
  commentHighlightActive: "#c084fc",
  commentHighlightResolved: "rgba(45, 212, 191, 0.22)",
  commentHighlightResolvedActive: "#2dd4bf",
  headingRule: "rgba(233, 213, 255, 0.24)",
  inlineCodeBackground: "rgba(196, 181, 253, 0.16)",
  inlineCodeText: "#f9a8d4",
  insertHighlightText: "#c084fc",
  leafAccent: "#d8b4fe",
  leafBackground: "#12091f",
  leafBorder: "rgba(139, 92, 246, 0.34)",
  leafInputBackground: "rgba(196, 181, 253, 0.16)",
  leafResolvedBackground: "rgba(45, 212, 191, 0.22)",
  leafResolvedBorder: "#2dd4bf",
  leafSecondaryText: "#ddd6fe",
  leafShadow: "0 20px 48px rgba(2, 6, 23, 0.48), 0 0 0 1px rgba(196, 181, 253, 0.08)",
  leafText: "#f5f3ff",
  linkText: "#d8b4fe",
  selectionBackground: "rgba(167, 139, 250, 0.26)",
  selectionHandleBackground: "#12091f",
  selectionHandleBorder: "#d8b4fe",
  tableBodyBackground: "rgba(30, 27, 75, 0.88)",
  tableBorder: "rgba(139, 92, 246, 0.34)",
  tableHeaderBackground: "rgba(49, 46, 129, 0.94)",
  text: "#ede9fe",
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
