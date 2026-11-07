## 🗓️ v0.2.0 (11-06-26)

- Fixed headings with bold text stopping the editor from updating
- Markdown round-trips much more faithfully: ordered list numbers, nested and indented lists, task-item children, wrapped and lazy continuation lines, nested emphasis, bracketed link text, long code fences, multi-line HTML blocks, and a heading's trailing `#` now survive a save
- Saved markdown no longer changes meaning on reload: text that looks like HTML, strikethrough, a directive or front matter is escaped, and underscores in words like `snake_case` are left alone
- Parsing follows CommonMark more closely, so quotes split by a blank line stay separate, ragged table rows gain empty cells, and prose like `2021. It works` or `Note:Use` stays prose
- Reference links, indented code and setext headings are now saved as inline links, fenced code and `#` headings
- Enter, Backspace, Tab and Shift+Tab in lists now split, lift, merge and number items without dropping or reordering content
- Enter and heading changes keep inline formatting, and Enter at the start of a block keeps the caret with its text
- Typing a closing bracket over a matching one now types over it instead of doubling it
- PageUp and PageDown move by the viewport height, keep the line you left visible, and reach the first and last line
- SVG badges and images that block CORS now load, badges paint at their real size without shifting the page as they load, and a linked image opens its link from anywhere on it
- Code blocks stay readable while the caret is inside them, and syntax colors hold up on selected and changed lines
- Long documents with code blocks keep a steady scroll height instead of creeping as you scroll or jumping on the first keystroke
- Tall table rows and code blocks paint completely while they fill the screen or are scrolled partway out of view, keeping their text, background, borders, highlights and animations
- Typing in a table or pressing Enter in a long document no longer makes the view jump
- Multi-line HTML blocks paint line by line as written, and Enter adds a line inside them
- Tables paint cell tints and borders at each column's real width, and the table toolbar no longer covers the next row
- List bullets sit beside items that start with code or a quote, instead of inside them
- Comment bodies now render headings, quotes, code blocks and tables
- `onUserMentioned` now reports the correct line after paragraphs with soft line breaks
- The caret stops blinking and repainting while the editor is unfocused
- Typing in long paragraphs and code blocks, and scrolling documents of any length, now do less layout work

## 🗓️ v0.1.1 (11-01-26)

- Upgraded numerous dependencies to improve perf/reliability

## 🗓️ v0.1.0 (09-10-26)

- Introduced the `<Documint previousContent>` prop, which allows rendering a diff between two specific versions

## 🗓️ v0.0.36 (09-03-26)

- Basic frontmatter support allows reading and editing document metadata
- New virtual scrollbar makes navigating docs easier

## 🗓️ v0.0.35 (08-26-26)

- Syntax triggers can now be used on non-empty lines
- Theme colors now support `oklch` values

## 🗓️ v0.0.34 (06-26-26)

- Introduced keybindings/support for navigating and deleting by word

## 🗓️ v0.0.33 (06-26-26)

- Added a `readOnly` prop to the `Documint` component to allow hosts to put the editor in a comment-only mode

## 🗓️ v0.0.32 (06-25-26)

- Added a `showDiffs` prop to the `Documint` component to allow hosts to disable diff highlights

## 🗓️ v0.0.31 (06-25-26)

- Initial support for inline diffs from external changes
- Misc. bug fixes for round-tripping empty lines/spaces

## 🗓️ v0.0.30 (06-16-26)

- Misc. bug fixes with lists, tasklist items, and paste

## 🗓️ v0.0.29 (06-15-26)

- Introduce basic syntax highlighting, with support for embedder apps to add custom languages via the new `grammars` property on the component

## 🗓️ v0.0.28 (06-08-26)

- Introduced the ability to customize editor effects (e.g. text inserted animation)

## 🗓️ v0.0.27 (06-06-26)

- Presence avatars now pulse when working anchored to an unresolved comment
- Added x-ray mode to the debug-time playground

## 🗓️ v0.0.26 (06-04-26)

- Added a new font size setting to the theme API
- Added an initial canvas extension for the GitHub Copilot app

## 🗓️ v0.0.25 (06-02-26)

- Introduced a new VS Code extension (still super early!)

## 🗓️ v0.0.24 (05-31-26)

- The selection leaf now includes a menu to copy/cut/paste (which is really useful on mobile)

## 🗓️ v0.0.23 (05-30-26)

- Comments now support basic markdown rendering
- The component now supports a `revision` prop, and publishes a `patch` property in the `onContentChanged` event, in order to better synchronize edits with a file/server

## 🗓️ v0.0.22 (05-28-26)

- Added support for status messages in user presence
- Added the notion of resource protocols
- Inline code formatting can now compose with other formatting marks (e.g. underline, italics)
- The comment thread leaf now auto-scrolls as new replies are added (either by you or an agent!)

## 🗓️ v0.0.21 (05-26-26)

- Added initial search support (`CMD+F`)

## 🗓️ v0.0.20 (05-24-26)

- Added basic support for code blocks
- Added different list markers for 2nd and 3rd depth unordered lists

## 🗓️ v0.0.19 (05-22-26)

- Added support for superscript text formatting
- Improved editing perf on large documents

## 🗓️ v0.0.18 (05-18-26)

- Commment threads now display a status indicator when a presence user is associated with it

## 🗓️ v0.0.17 (05-17-26)

- Various performance improvements for scrolling/editing large documents

## 🗓️ v0.0.16 (05-15-26)

- Added support for presence indicators to be anchored to comment threads, in addition to text positions.
- Added a new `pulse` property to the decoration API, which allows embedders to indicate a background decoration should pulse.

## 🗓️ v0.0.15 (05-13-26)

- Introduced support for text decorations, which allow an embedder to specify regex-based decorations that are applied asynchronously as the user edits.

## 🗓️ v0.0.14 (05-12-26)

- Added support for indenting/dedenting blocks via horizontal swipe gestures on mobile (which is the mobile equivalent of `Tab`/`Shift+Tab`)
- Added support for tab-transforming a paragraph into a blockquote

## 🗓️ v0.0.13 (05-11-26)

- Added support for brace completion when typing an opening `(`, `{`, or `[` character.

## 🗓️ v0.0.12 (05-10-26)

- Added support for emoji completions in the document and in comments
- Added support for @mentions in the document, as well as a new `onUserMentioned` event on the `Documint` component

## 🗓️ v0.0.11 (05-07-26)

- Introduced a new `actions` prop on the component that allows embedders to define custom buttons that appear in contextual menus (e.g. when text is selected).

## 🗓️ v0.0.10 (05-05-26)

- You can now insert a link by selecting some text and pasting a URL.
- Fixed some bugs with auto-completion/correction when typing

## 🗓️ v0.0.9 (05-05-26)

- Added a new `openFile` method to the custom storage API, so that embedders can detect and handle clicking links to non-HTTP resources (e.g. opening a local file)

## 🗓️ v0.0.8 (05-03-26)

- Added support for document dividers (`---`)
- Added support for pressing `SHIFT+ENTER` in order to create "soft breaks" within a paragraph/heading/list item.

## 🗓️ v0.0.7 (04-30-26)

- Added support for copying and pasting content in a semantic/structural way.

## 🗓️ v0.0.6 (04-29-26)

- Images are now resizable by selecting them and them dragging the resize handles
- You can know `SHIFT+Click` to extend a selection (in addition to the existing drag support)

## 🗓️ v0.0.5 (04-28-26)

- The `Documint` component now exposes an optional `storage` prop which allows the embedder to define a virtual filesystem for reading and writing images.

## 🗓️ v0.0.4 (04-27-26)

- Voice dictation is now supported
- Supports roundtripping markdown files with frontmatter
- Added a new `onCommentChanged` prop to the `Documint` component that fires when a comment is added, edited, or deleted. The event carries the affected comment, the IDs of any `@`-mentioned users, and the thread it belongs to.

## 🗓️ v0.0.3 (04-26-26)

- Introduced the ability to @mention users in a comment. The list of mentionable users is provided by the new `users` prop on the `Documint` component.
- Improved scrolling performance on mobile

## 🗓️ v0.0.2 (04-24-26)

- Added support for select all (`Cmd/Ctrl + A`) and multi-block selections in general

## 🗓️ v0.0.1 (04-23-26)

- Initial release 🚀
