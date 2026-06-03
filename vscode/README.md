# 🌿 Documint (VS Code)

Documint is a VS Code custom editor for Markdown files. It wraps the `documint` React editor so `*.md` files can be edited as structured Markdown while still saving plain Markdown back to disk.

## Features

- Opens Markdown files with the `Documint` custom editor.
- Keeps the VS Code text document in sync with edits made in the canvas editor.
- Supports external file changes by pushing updated Markdown into the webview.
- Reads local image assets from the current workspace and supports pasted/uploaded assets next to the Markdown file.

## Known Issues

- The extension currently provides the editor wrapper only; settings for themes, keybindings, and collaboration features are not exposed yet.
- Local asset access is limited to the current workspace, or to the Markdown file's directory when no workspace folder is open.
