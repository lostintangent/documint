# 🌿 Documint

A canvas-based, batteries-included Markdown editor for React. Documint is built for usability and performance, using a fully bespoke Markdown parser, layout/renderer, component system ("leaves"), and reactive store ("sprigs"). This gives you a really nice WYSIWYG editor, without any of the dependency bloat 💪

> _Try it out:_ [web playground](https://lostintangent.github.io/documint) and [VS Code extension](https://marketplace.visualstudio.com/items?itemName=lostintangent.documint-vscode).

## Features

- **Markdown in, markdown out** — Documents are parsed from markdown and serialized back to markdown. Full support for CommonMark, GFM tables, task lists, strikethrough, and fenced code blocks with language hints.

- **Rich semantic editing** — Context-sensitive behavior that adapts to what you're editing. `Enter` splits a paragraph but adds a new row in a table. `Backspace` at the start of a list item dedents it. `Tab` indents a list but inserts a column in a table. The editor understands the structure of your document, so every gesture does the right thing.

- **Subtle, delightful animations** — A typing trail highlights newly inserted text. Deleted text fades out before disappearing. List markers pop into place. Punctuation pulses with a soft ring on keystroke. Small details that make everyday editing feel fun.

- **Context-aware toolbars ("leaves")** — As you move around a documint, specialized toolbars will appear based on what you're interacting with: text formatting options on selection, link editing on links, column/row controls on tables, and block insertion (headings, lists, quotes, tables) on empty lines.

- **Comments and presence for review workflows** — Anchor comments to any range of text, with full threading (replies, resolution, deletion) and self-repairing quote-based matching after edits. External user and AI agent presence can be projected into the document as live cursors and viewport indicators without becoming document content.

- **Fast and lightweight** — Canvas-based rendering optimized for hot-path performance even on large documents (120 FPS). A custom markdown parser, editor engine, and layout/rendering system all ship in a bundle ~100 KB gzipped.

- **Configurable themes and keybindings** — Ships with built-in light and dark themes, follows the system theme by default, and lets you customize every theme value. Keybindings are configurable too — remap formatting shortcuts, navigation, and list operations to match your users' expectations.

- **Mobile-native editing** — Responsive layout with full support for iOS and Android gestures: auto-capitalization, auto-correct, auto-scroll on keyboard appearance, shake-to-undo, and selection handles all work as expected.

## Getting Started

1. Install the package: `npm install @lostintangent/documint` (or `bun add @lostintangent/documint`)
1. Import the `Documint` component from the package
1. Pass your markdown content to it and listen for changes

```tsx
import { useState } from "react";
import { Documint } from "@lostintangent/documint";

const initialMarkdown = `# Hello Documint

This editor takes markdown in and gives markdown back out.
`;

export function App() {
  const [content, setContent] = useState(initialMarkdown);

  return <Documint content={content} onContentChanged={setContent} />;
}
```

`onContentChanged` emits the full next markdown snapshot. Hosts that need minimal text edits can diff their previous content against the snapshot inside their own text model.

## Custom Keybindings

Pass `keybindings` to replace the built-in bindings. To add or override bindings while retaining the defaults, put overrides first and spread `defaultKeybindings` after them; the first matching binding wins.

```tsx
import { Documint, defaultKeybindings, type EditorInputKeybinding } from "@lostintangent/documint";

const keybindings: readonly EditorInputKeybinding[] = [
  { key: "b", modKey: true, command: "toggleCode" },
  ...defaultKeybindings,
];

<Documint content={content} onContentChanged={setContent} keybindings={keybindings} />;
```

`modKey` means exactly Command on macOS and Control elsewhere. Omitted modifiers mean unmodified; use `shiftKey: "any"` when a binding should match with or without Shift, and `platform: "mac"` or `"nonMac"` for platform-specific bindings. The map covers named editor shortcuts; ordinary typing and unmodified arrow/Page navigation remain built-in input behavior.

## Read-Only Review Mode

Pass `readOnly` to let users select text, copy, and use review chrome without changing document content. Content-editing affordances such as typing, paste, cut, formatting, link editing, table controls, insertions, and image resize are disabled or not shown. Comments still persist through `onContentChanged`, so keep that callback wired when read-only users should be able to create, reply to, resolve, edit, or delete comments.

```tsx
<Documint content={content} onContentChanged={setContent} readOnly />
```

## Custom Actions

Use the `actions` prop to add custom buttons to contextual leaf menus. The first supported target is `selection`, which appears in the annotation toolbar when text is selected. Each action provides a Lucide icon name and receives the selected text when clicked.

```tsx
import { useState } from "react";
import { Documint } from "@lostintangent/documint";

export function App() {
  const [content, setContent] = useState("Select this text");

  return (
    <Documint
      content={content}
      onContentChanged={setContent}
      actions={{
        selection: {
          icon: "copy",
          label: "Copy selected text",
          onClick: (selectedText) => {
            navigator.clipboard.writeText(selectedText);
          },
        },
      }}
    />
  );
}
```

## Custom Themes

By default, Documint follows the end-user's system preference and applies its built-in light or dark theme. Pass `lightTheme`, `darkTheme`, or a custom `EditorTheme` to select one concrete theme explicitly. When a host supplies a theme, the host owns switching it as the app's color mode changes.

```tsx
import { useState } from "react";
import { Documint, lightTheme } from "@lostintangent/documint";

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
import { Documint, DocumintStorage } from "@lostintangent/documint";

const storage = createInMemoryStorage();

export function App() {
  const [content, setContent] = useState("# Documint with Custom Storage");

  return <Documint content={content} onContentChanged={setContent} storage={storage} />;
}

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
```

## Text Decorations

Use the `decorations` prop to style text that matches host-provided regular expressions. Decorations are worker-derived presentation ranges, update asynchronously as content changes, and are not serialized back to markdown. Link text keeps the theme link color when it overlaps a text-color decoration.

```tsx
import { useState } from "react";
import { Documint, type DocumintDecoration } from "@lostintangent/documint";

const decorations: readonly DocumintDecoration[] = [
  { pattern: /\blist\b/gi, color: "red", backgroundColor: "rgba(255, 0, 0, 0.12)" },
];

export function App() {
  const [content, setContent] = useState("A list of things");

  return <Documint content={content} onContentChanged={setContent} decorations={decorations} />;
}
```
