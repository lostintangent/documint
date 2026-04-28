# 🌿 Documint

A canvas-based, batteries-included markdown editor for React.

> Try it out: [Documint playground](https://lostintangent.github.io/documint).

## Features

- **Markdown in, markdown out** — Documents are parsed from markdown and serialized back to markdown. Full support for CommonMark, GFM tables, task lists, strikethrough, and fenced code blocks with language hints.

- **Subtle, delightful animations** — A typing trail highlights newly inserted text. Deleted text fades out before disappearing. List markers pop into place. Punctuation pulses with a soft ring on keystroke. Small details that make editing feel fun.

- **Mobile-native editing** — Responsive layout with full support for iOS and Android gestures: auto-capitalization, auto-correct, auto-scroll on keyboard appearance, shake-to-undo, and selection handles all work as expected.

- **Rich semantic editing** — Context-sensitive behavior that adapts to what you're editing. Enter splits a paragraph but adds a new row in a table. Backspace at the start of a list item dedents it. Tab indents a list but inserts a column in a table. The editor understands the structure of your document, so every gesture does the right thing.

- **Context-aware toolbars ("leaves")** — Floating toolbars that appear based on what you're interacting with: text formatting options on selection, link editing on links, column/row controls on tables, and block insertion (headings, lists, quotes, tables) on empty lines.

- **Configurable themes and keybindings** — Ships with built-in light and dark themes, follows the system theme by default, and lets you customize every theme value or start from presets like mint, midnight, and sunrise. Keybindings are configurable too — remap formatting shortcuts, navigation, and list operations to match your users' expectations.

- **Comments and presence for review workflows** — Anchor comments to any range of text, with full threading (replies, resolution, deletion) and self-repairing quote-based matching after edits. External user and AI agent presence can be projected into the document as live cursors and viewport indicators without becoming document content.

- **Fast and lightweight** — Canvas-based rendering optimized for hot-path performance even on large documents. A custom markdown parser, editor engine, and layout/rendering system all ship in a bundle <70 KB gzipped.

## Getting Started

1. Install the package: `npm install documint` (or `bun add documint`)
2. Import the `Documint` component from the package
3. Pass your markdown content to it and listen for changes

```tsx
import { useState } from "react";
import { Documint } from "documint";

const initialMarkdown = `# Hello Documint

This editor takes markdown in and gives markdown back out.
`;

export function App() {
  const [content, setContent] = useState(initialMarkdown);

  return <Documint content={content} onContentChanged={setContent} />;
}
```

## Custom Themes

By default, Documint will detect the end-user's system theme and apply either the built-in light or dark theme. You can also specify a theme explicitly by passing `"light"` or `"dark"` to the `theme` prop, or provide a custom theme object with your own colors and styles.

```tsx
import { useState } from "react";
import { Documint, lightTheme } from "documint";

const customTheme = {
  ...lightTheme,
  background: "#fff7ed",
  headingText: "#7c2d12",
  linkText: "#c2410c",
};

export function App() {
  const [content, setContent] = useState("# Themed Documint");

  return <Documint content={content} onContentChanged={setContent} theme={customTheme} />;
}
```

## Custom Storage

If the document includes http-based images, then the editor will automatically load and render them. However, if you want to support pasting images from the clipboard or uploading images from the user's device, you'll need to provide a `storage` prop that implements the `DocumintStorage` interface.

```tsx
import { useState } from "react";
import { Documint, DocumintStorage } from "documint";

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

export function App() {
  const [content, setContent] = useState("# Documint with Custom Storage");

  return <Documint content={content} onContentChanged={setContent} storage={storage} />;
}
```