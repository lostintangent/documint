# Documint (Architecture + Contribution Guidelines)

## Architecture

Documint is a layered editor with a functional core and explicit edge effects. Content flows through one pipeline, and each layer owns one transition:

`markdown → Document → EditorState → EditorLayoutState → renderer → pixels`

Each layer builds on the immutable output of the one before it. Lower layers never reach upward, and higher layers never re-implement lower-layer semantics.

`Document`, `EditorState`, and `EditorLayoutState` are immutable snapshots. Mutations return new snapshots with structural sharing, so unchanged roots, indexes, selections, and layout artifacts keep their identity and downstream caches can prove what did not change. Selection moves keep the same `documentIndex`.

Effects stay at the edge, so most subsystems are pure functions of their inputs. DOM and canvas measurement, `requestAnimationFrame`, browser events, image loading, mutable caches, and drawing belong to `src/component` or clearly marked browser-facing helpers. Clocks, resources, and caches are passed in explicitly, even when an API offers a default, and long-lived mutable state never lives inside the snapshots.

The stages run at different cadences. Markdown parses when content arrives from the host or the clipboard, and serializes for the clipboard and after every local edit so the host always has current content. Every edit or selection move produces a new `EditorState`. Layout recomputes lazily, only for edits its cache cannot cover, scroll, or resize, so selection moves, animation ticks, and caret blinks reuse it.

## Subsystems

Each subsystem has its own `AGENTS.md` for local rules and ownership. Use this map to choose the correct layer, then read that subsystem guide before editing.

- [`src/document`](src/document/AGENTS.md) - Semantic document truth: immutable block/inline trees, plain-text projections, structural paths, anchors, queries, and comment threads as anchored annotations.
- [`src/markdown`](src/markdown/AGENTS.md) - File and clipboard boundary: direct `markdown → Document → markdown` parsing, serialization, fragments, front matter, tables, and comment directives.
- [`src/editor`](src/editor/AGENTS.md) - Framework-agnostic editor engine: document indexing, state, commands, selection, navigation, anchors, layout, hit testing, and text measurement.
- [`src/renderer`](src/renderer/AGENTS.md) - Immediate-mode painting from prepared editor/layout inputs to canvas pixels.
- [`src/component`](src/component/AGENTS.md) - React/browser host: content bridging, orchestration, effects, image loading, render scheduling, hooks, overlays, and leaf UI.
- [`extensions/vscode`](extensions/vscode/AGENTS.md) - VS Code custom editor that opens `*.md` files in Documint while VS Code's text document stays the file's truth.
- [`extensions/github`](extensions/github/AGENTS.md) - GitHub Copilot canvas that edits a markdown file beside a Copilot session and turns @Copilot mentions into agent edits.
- `playground` - Dogfooding app for real browser behavior.
- `scripts` - Build, packaging, benchmark, and automation scripts.
- `test` - Unit tests, golden fixtures, and benchmark support.

## Writing great code

- Make the smallest change that fully solves the problem, and delete whatever it makes unnecessary. A change that removes more than it adds is often the best one.
- Extend an existing mechanism before adding a parallel one. When two paths do the same job under different names, merge them.
- Keep typing, scrolling, layout, and paint costs proportional to what changed. Features that aren't in use should cost close to nothing.
- Favor declarative data over imperative APIs: animations are descriptors, commands are state-to-state transforms, and layout and paint policies live in tables or small policy objects.
- Name things for what they mean, not how they work, and keep public APIs small. Add a helper module only when it clarifies ownership, reuse, or reading. Skip pass-through wrappers, compatibility aliases, and dead exports.
- Make files read top-to-bottom: main entrypoint first, helpers in dependency order. Comment only file roles, non-obvious invariants, and complex logic.

## Writing great tests

- Test behavior in the subsystem that owns it, with focused unit tests rather than broad UI smoke tests.
- Write tests that would fail without the change and cover its edge cases, not only the common case. Skip tests that restate the implementation, constants, or exports.
- Protect markdown round-trips with golden tests, and add or update benchmark coverage when changing a hot path.
- Group tests in `describe` blocks ordered from common case to edge case, and order tests within each group the same way.
- Put helpers in the lowest subsystem they apply to (`test/document/`, `test/markdown/`, `test/editor/`, `test/renderer/`). Higher subsystems may import from lower ones, never the other way around.

## Definition of done

1. `bun run check` and `bun test` pass.
1. `bun run build:dev` and `bun run build:prod` succeed, and the built `dist/index.d.ts` changes only when the public API changes on purpose.
1. Both extensions still build: `bun run build:prod` in `extensions/vscode` and `bun run build` in `extensions/github`.
1. `bun run benchmark` passes when a change touches a hot path.
1. Browser-facing changes work in the playground, checked with the `verify` skill.
1. Markdown round-trips, undo/redo, selection, and comments stay intact.
1. Subsystem `AGENTS.md` files are updated with the `codify` skill when design intent, ownership, or file roles change.
