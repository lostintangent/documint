import { darkTheme, lightTheme, midnightTheme, mintTheme, type EditorTheme } from "documint";

const sampleMarkdown = `# 🎓 Tutorial Document

Welcome to Documint 👋, a canvas-based markdown editor for rich documents with formatting, tables, images, comments, mentions, and custom decorations.

Use the theme control in the upper right to preview how hosts can recolor the editor surface.

As you edit the document, the markdown updates on the right; you can also edit that markdown directly to update the document.

## ✍️ Formatting

Use *emphasis*, **strong text**, ~~strikethrough~~, <ins>underline</ins>, \`inline code\`, and [links](https://example.com) inline.

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

![Editor shell](https://dummyimage.com/960x540/0f172a/f8fafc.png&text=Editor+Shell "Wide host")
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

## 🎨 Decorations

Hosts can define decorations from text patterns and use them to apply custom foreground colors, background colors, or pulse animations.

- one (1)
- two (2)
- three (3)

The numbered markers above use a foreground color decoration, while TODO uses a highlighted background.

The word lesson uses a pulsing decoration so the playground can exercise paint-only animation without changing editor state.

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
