# VS Code Extension

The VS Code extension opens `*.md` files in Documint as a custom text editor, so users get WYSIWYG markdown editing without giving up VS Code's own file handling. VS Code's `TextDocument` stays the file's truth, and Documint runs in a webview that mirrors it. The host half runs in VS Code's extension host, the webview half runs Documint in a browser frame, and the two share only the typed messages in `src/types.ts`.

## Design Notes

- **The `TextDocument` stays the source of truth, so saving, dirty state and other editors keep working.** Webview edits become a `WorkspaceEdit` over the smallest changed range, and VS Code owns saving and the dirty indicator from there. Changes from anywhere else, such as a side-by-side text editor, a formatter or a git checkout, arrive through `onDidChangeTextDocument` and reach the webview as `set-content`. `retainContextWhenHidden` keeps the editor's state while its tab is hidden.
- **`syncedContent` keeps the webview from getting its own edits back.** Documint treats a new `content` prop as an external replacement (see [`src/component/sync`](../../src/component/sync/AGENTS.md)), so an echoed edit would replace the editor state and could drop keystrokes typed after it. The host records the text it last sent or accepted, and its document change listener posts `set-content` only when the document differs from that text. Edits apply one at a time through `editQueue`, so each range is diffed against the text the previous edit left.
- **A ready handshake keeps the first content from being lost.** The webview posts `ready` once its message listener is installed, and the host answers with the current text. The host never posts content when it creates the webview, since the webview may not be listening yet.
- **Local images stay inside the workspace.** `localResourceRoots` exposes only the webview bundle, so every local image goes through the host. Reads resolve relative to the document, accept absolute and `file://` paths, reject other URI schemes, and must land inside the document's workspace folder, or its directory when it has none. Pasted images go to `<document name>.assets/` beside the document under a UUID-prefixed, sanitized name, and the host returns a relative path for the markdown.
- **The theme follows VS Code's CSS variables.** VS Code exposes its colors as `--vscode-*` variables and marks dark and light themes with a body class. `useTheme` maps them onto an `EditorTheme`, watches class and style changes to follow theme switches, and keeps the previous theme object when the values match so Documint doesn't repaint for nothing. On macOS it adds 2px to VS Code's editor font size, whose 12px default there is tuned for code, so prose starts at 14px.

## Known Limitations

- **Untitled documents and virtual workspaces can't show or paste local images.** Storage requires a `file:` document and resolves paths with Node's `path` module. Move it to `workspace.fs` URIs throughout if those documents need images.

## Subsystem Map

- `src/host/textEditorProvider.ts` owns the custom editor: webview setup and content security policy, document and webview sync, edit application, and message handling.
- `src/types.ts` owns the host and webview message protocol.
- `src/host/storage.ts` owns resource path resolution, the workspace boundary, pasted image writes, and media types.
- `src/webview/main.tsx` owns the webview app: the ready handshake and the `Documint` mount.
- `src/webview/storage.ts` owns the `DocumintStorage` adapter that turns storage calls into `id`-matched requests.
- `src/webview/hooks/useTheme.ts` owns the mapping from VS Code theme variables to `EditorTheme`.
- `esbuild.js` owns the CommonJS host bundle and the ES module webview bundle, and `package.json` owns the custom editor contribution and packaging scripts.
