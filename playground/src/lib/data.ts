import { darkTheme, lightTheme, type CodeGrammarRule, type EditorTheme } from "@lostintangent/documint";

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

Use fenced code blocks for source snippets and configuration. JavaScript, TypeScript, and Markdown are highlighted out of the box, and the tree below uses a custom \`tree\` grammar the playground passes in — ampersands render as strings, pipes and underscores as keywords.

\`\`\`tree
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
        "body": "Comments support markdown formatting: **bold**, *italic*, <ins>underline</ins>, and \`inline code\`.\\n\\n- Keep review notes close to the quoted text.\\n- Use formatting when a comment needs structure.",
        "updatedAt": "2026-04-05T12:02:00.000Z"
      },
      {
        "body": "@demo Comments also support bare at-mentions and lists:\\n\\n1. Mention a collaborator.\\n2. Add the follow-up items inline.",
        "updatedAt": "2026-04-05T12:03:00.000Z"
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

const sampleSpecMarkdown = `# Spec: Syntax Highlighting as Code-Targeted Decorations

A working specification for fenced code block syntax highlighting in Documint, modeled as a code-specific form of the existing decoration system.

## Core Principle

A syntax highlight is a decoration whose target is a code block's \`source\` region and whose color comes from a grammar token kind resolved against the theme. It differs from a host decoration in exactly two places — the **target region** and the **range generation** — and is identical everywhere else. By the time a highlight crosses the worker boundary, it is a plain colored decoration range, indistinguishable from a host decoration.

## What Does Not Change

These carry the feature with zero modification, which is what keeps the bundle delta small:

- **Renderer and painter.** Color-only overlays reuse the existing decoration painters and self-skip the contrast and pulse logic.
- **Segments.** Code lines stay a single text run; color layers on as an asynchronous overlay, so the base layer stays synchronous and correct with no reflow when a token's color changes.
- **Index and reconciliation.** The decoration index and its reconciliation are reused with no new fields; a token kind never appears downstream of the hook.
- **Names.** The decoration hook, worker, and client keep their decoration-based names.

## Shared Range Primitive

The per-character merge is shared by prose decorations and code grammars. The prose pass keeps its plain-text traversal; the code pass adds a source traversal that emits ranges at the code block's source path. Neither pass imports the other.

## Data Model

Grammars are authored with token kinds, which are theme-independent:

\`\`\`ts
export type CodeTokenKind =
  | "keyword" | "string" | "comment" | "number" | "function"
  | "type" | "atom" | "punctuation" | "heading" | "emphasis"
  | "strong" | "link" | (string & {});

// A grammar is just an ordered list of these — no wrapper type.
export type CodeGrammarRule = { pattern: RegExp; token: CodeTokenKind };
\`\`\`

This is an ordered regex lexer — first match wins per character — not a contextual or TextMate-style grammar. It has no nesting, no state, and no semantic accuracy, which keeps the built-in grammars compact.

## Flow

1. The component merges the host \`grammars\` prop over the built-in grammars.
2. The decoration hook resolves each token kind to a color via the theme, producing two config buckets: prose rules and code grammars. Both are plain pattern-and-color rules.
3. The worker is configured atomically — a single message carries both buckets under one key, so no request can observe a mixed configuration.
4. The worker runs two passes per root, prose and code, and concatenates the colored ranges.
5. Ranges reconcile into the existing decoration index and paint through the existing overlay. A theme switch re-tokenizes code off-thread, consistent with how decorations already converge.

## Built-In Grammars

Markdown and JavaScript/TypeScript ship enabled by default. The \`grammars\` prop always merges over the built-ins, so a host adds a language without losing the defaults:

\`\`\`ts
<Documint grammars={{ rust: rustGrammar }} />
\`\`\`

Passing no \`grammars\` uses the built-ins; an object merges over them; \`null\` disables code highlighting entirely.

## Theme Extension

The theme gains an optional \`codeTokens\` map of token kind to color. The resolver derives the code background first, selects a light or dark token palette from it, then merges any host overrides on top. Every built-in and playground theme inherits token colors automatically; a host sets \`codeTokens\` only to override.

## Rendering

Highlights flow as colored decoration ranges through the existing overlay painter. The base code text paints synchronously in the default code color, and token colors layer on top as worker results arrive. Because color does not affect geometry, a token changing color never triggers layout.

## Files

- **New.** The shared range primitive, the grammar types and built-in grammars, and the code range pass.
- **Changed.** The decoration ranges module, the worker protocol and entry, the decoration hook, the theme types and resolver, and the editor component.

## Phasing

1. **Vertical slice.** Shared primitive, theme tokens, the JavaScript grammar, hook resolution, and the worker code pass — a code block highlighting in the playground.
2. **Breadth.** The markdown grammar, language aliases, and built-in wiring.
3. **Polish.** A code-heavy paint benchmark, a per-rule step guard on the worker, and more languages.

## Testing

- Code ranges over source, including nested code blocks and unknown languages.
- Shared range parity, so the prose path is unchanged after extraction.
- Theme resolution of token defaults and overrides.
- Worker config staleness and atomicity.
- Markdown round-trip stability and a code-heavy paint benchmark.

## Open Questions

- Whether to keep the term *grammar* or rename to *lexer* for mechanism accuracy.
- The canonical token vocabulary and how unknown tokens fall back.
`;

const scrollingTestMarkdown = createRealisticLongMarkdown(80, "Scrolling Test");

export const fixtureOptions = [
  {
    id: "sample",
    label: "Tutorial document",
    markdown: sampleMarkdown,
  },
  {
    id: "spec",
    label: "Sample spec",
    markdown: sampleSpecMarkdown,
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

// A host-provided grammar for the tutorial's ```tree block, demonstrating that
// custom languages merge over the built-ins (markdown, JS/TS). Ampersands use
// the string token; pipes and underscores use the keyword token. Module-level so
// it keeps a stable identity across renders.
export const grammars: Record<string, readonly CodeGrammarRule[]> = {
  tree: [
    { pattern: /&+/, token: "string" },
    { pattern: /[|_]+/, token: "keyword" },
  ],
};

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
  accent: "#ea580c",
  activeBlockBackground: "rgba(251, 191, 36, 0.18)",
  activeBlockFlash: "rgba(249, 115, 22, 0.3)",
  codeText: "#ffedd5",
  commentHighlight: "rgba(253, 186, 116, 0.34)",
  commentHighlightActive: "#ea580c",
  commentHighlightResolved: "#fde68a",
  commentHighlightResolvedActive: "#f59e0b",
  inlineCodeBackground: "rgba(194, 65, 12, 0.08)",
  inlineCodeText: "#9a3412",
  leafBorder: "rgba(234, 88, 12, 0.24)",
  leafSecondaryText: "#9a3412",
  linkText: "#c2410c",
  blockquoteText: "#9a3412",
  text: "#7c2d12",
  selectionBackground: "rgba(251, 146, 60, 0.24)",
  background: "#fff7ed",
  tableBorder: "rgba(234, 88, 12, 0.24)",
  tableHeaderBackground: "rgba(255, 237, 213, 0.96)",
};

const mintTheme: EditorTheme = {
  ...lightTheme,
  accent: "#059669",
  activeBlockBackground: "rgba(16, 185, 129, 0.14)",
  activeBlockFlash: "rgba(16, 185, 129, 0.26)",
  background: "#f3fbf6",
  blockquoteText: "#166534",
  codeText: "#dcfce7",
  commentHighlight: "rgba(52, 211, 153, 0.26)",
  commentHighlightActive: "#10b981",
  commentHighlightResolved: "rgba(187, 247, 208, 0.96)",
  commentHighlightResolvedActive: "#059669",
  externalChangeAdditionBackground: "rgba(14, 165, 233, 0.18)",
  headingRule: "rgba(20, 83, 45, 0.18)",
  inlineCodeText: "#166534",
  insertHighlightText: "#10b981",
  leafBorder: "rgba(22, 163, 74, 0.24)",
  leafSecondaryText: "#166534",
  leafShadow: "0 14px 40px rgba(20, 83, 45, 0.14)",
  linkText: "#047857",
  selectionBackground: "rgba(52, 211, 153, 0.24)",
  tableBorder: "rgba(22, 163, 74, 0.24)",
  tableHeaderBackground: "rgba(220, 252, 231, 0.96)",
  text: "#14532d",
};

const midnightTheme: EditorTheme = {
  ...darkTheme,
  accent: "#d8b4fe",
  activeBlockBackground: "rgba(168, 85, 247, 0.16)",
  activeBlockFlash: "rgba(243, 232, 255, 0.13)",
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
  leafBackground: "#12091f",
  leafBorder: "rgba(139, 92, 246, 0.34)",
  leafSecondaryText: "#ddd6fe",
  leafShadow: "0 20px 48px rgba(2, 6, 23, 0.48), 0 0 0 1px rgba(196, 181, 253, 0.08)",
  leafText: "#f5f3ff",
  selectionBackground: "rgba(167, 139, 250, 0.26)",
  selectionHandleBackground: "#12091f",
  tableBodyBackground: "rgba(30, 27, 75, 0.88)",
  tableBorder: "rgba(139, 92, 246, 0.34)",
  tableHeaderBackground: "rgba(49, 46, 129, 0.94)",
  text: "#ede9fe",
};

export const themeOptions = [
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
