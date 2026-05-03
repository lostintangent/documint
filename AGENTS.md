# AGENTS.md

## Mission

Build a markdown-native writing surface that stays rendered as a document — content displays as polished output, and the active block or span (whichever the caret or selection sits in) reveals source-like editing affordances. The semantic truth is `Document`; the editor projects it into `EditorState` (immutable in-memory editing state, built around a `DocumentIndex` for hot-path lookup, with selection and history) and from there into `EditorLayoutState` (geometry packaged for paint). Pretext — a third-party text segmentation and layout library — handles low-level text measurement; everything else is bespoke.

## Product principles

- Markdown is the persistence boundary.
- The editing projection is semantic, not raw markdown text.
- Only the active region reveals source-like editing affordances.
- Comments are anchored annotations, not document content.
- Pretext never owns caret, IME, clipboard, undo, or live selection.
- Canvas is the live editor surface.

## Toolchain defaults

- Use Bun as the default package manager, script runner, bundler, and test runner.
- Use `oxlint` and `oxfmt`.
- Keep the playground healthy; it is a required dogfooding surface.

## Writing great code

- Start with the correct layer. Keep logic in the lowest correct subsystem and own it there completely instead of smearing one behavior across component, editor, markdown, and document layers.
- Use immutable data with structural sharing throughout. `Document`, `EditorState`, and `EditorLayoutState` are immutable values; mutations produce new values that share unchanged structure with the previous one. A selection move keeps the same `documentIndex` reference, which is exactly what lets the `EditorLayoutState` cache survive across the change. Pure-function transformations are easy to test in isolation and safe to cache against by reference identity.
- Push side effects to the edge. The editor engine — `Document`, `EditorState`, layout, query — is pure data and pure functions. Canvas pixels, DOM events, rAF scheduling, and `now` all live in [`src/component`](src/component/AGENTS.md), which owns the render loop. User input enters at the edge, flows inward as data transformations, then exits at the edge as paint calls. Concentrating side effects this way is what makes the engine testable without DOM stubs and lets the same immutable state drive multiple paint passes per frame.
- Favor declarative data over imperative APIs, without over-abstracting. Animations are descriptors paint resolves at frame time, not callbacks. Commands are state-to-state transforms, not setter sequences. Spacing, typography, and gap policies live in tables and small policy objects. The goal is clearer data flow, not indirection for its own sake — don't add a layer just to be pure.
- Prefer small, semantic public APIs. Export capabilities in terms of what they mean, not how they are implemented.
- Make files read clearly from top to bottom. Put the main entrypoint first, then the supporting helpers in dependency order.
- Use concise module comments when they help a reader understand the file’s role. Skip boilerplate commentary.
- Choose semantic names for functions, types, and variables. Avoid names that overfit the current implementation detail.
- Keep helper modules only when they earn their keep through clearer ownership, reuse, or simpler reading.

## Writing great tests

- Test the subsystem that owns the behavior.
- Prefer focused unit coverage over broad UI smoke tests.
- Use markdown golden tests to protect round-trip stability.
- Add or update benchmark coverage when changing layout, paint, viewport planning, or other hot paths.
- Verify the real browser behavior in the playground after meaningful UI changes, especially for input, scrolling, resize, and paint issues.
- Group tests logically with `describe` blocks, ordered common-case-first → edge-case-last; order the tests within each group the same way.
- Helpers belong in the lowest subsystem they apply to (`test/document/`, `test/markdown/`, `test/editor/`); higher subsystems import from lower ones, never the other way around.

## Architecture

The core data pipeline is `markdown → Document → EditorState → EditorLayoutState → canvas pixels`.

Each transition has its own cadence. `markdown ↔ Document` runs at file boundaries (load, save, clipboard). `Document → EditorState` produces a new immutable state per mutation or selection move. `EditorState → EditorLayoutState` is lazily recomputed when its layout-affecting inputs change — document structure the cache can't cover, scroll, or surface resize — so selection-only updates, animation ticks, and caret blinks reuse the cached layout state and skip straight to paint.

Common interactions in terms of that pipeline:

| Interaction | `EditorState` | `EditorLayoutState` | Paint |
| --- | --- | --- | --- |
| Document load / replace | new (new `documentIndex`) | fresh | content + overlay |
| Text or structural edit | new (new `documentIndex`) | invalidated, recomputed | content + overlay |
| Selection or caret move | new (same `documentIndex`) | reused from cache | content + overlay |
| Animation start | new (same `documentIndex`) | reused from cache | content + overlay |
| Animation in-flight tick | unchanged | reused from cache | content + overlay |
| Scroll | unchanged | invalidated, recomputed | content + overlay |
| Surface resize | unchanged | invalidated, recomputed | content + overlay |
| Caret blink (idle) | unchanged | reused from cache | overlay only |

The asymmetry that matters for performance: edits, scroll, and resize recompute layout; selection moves, animations, and caret blinks reuse it. That's why animations stay smooth during typing — the cache survives, and per-frame ticks are pure paint with no state churn (animations carry only `{ kind, startedAt, ...identifiers }` in `EditorState` and let paint compute the current frame from `now`).

### Render loop

Paint runs inside a coalesced `requestAnimationFrame` scheduler. There are no idle ticks — frames fire only in response to:

1. **User interactions** — typing, selection moves, drag, scroll, resize, theme change.
2. **In-flight animations** — the scheduler self-schedules content paints while animations are running. Pure paint, no state churn.
3. **Caret blink** — every 530ms, repaint just the overlay layer. The cheapest path.

See [`src/component`](src/component/AGENTS.md) for the schedule intents, coalescing rules, and which host effects trigger which paint mode.

At the repo root, think in terms of altitude and orchestration:

- `src/document` owns semantic document truth.
- `src/editor` owns the framework-agnostic editing engine capabilities that operate on that truth: projection, mutation, geometry, hit testing, and immediate-mode paint.
- `src/component` owns browser and React orchestration: when editor state changes, when layout is prepared, and when content/overlay canvases repaint.

Each subsystem has its own `AGENTS.md` with the lower-level boundaries and ownership.

- [`src/document`](src/document/AGENTS.md) - Closed, immutable semantic document model, including comment threads as anchored annotations.
- [`src/markdown`](src/markdown/AGENTS.md) - Markdown parsing and serialization boundary, implemented as a bespoke direct `markdown → Document → markdown` pipeline.
- [`src/editor`](src/editor/AGENTS.md) - Framework-agnostic editing engine: `Document` → `EditorState` → `EditorLayoutState` → canvas.
- [`src/component`](src/component/AGENTS.md) - React host: content bridging, browser lifecycle, and leaf UI.
- `playground` - Dogfooding app for exercising real browser behavior.
- `scripts` - Build, packaging, and benchmark automation.
- `test` - Unit tests, golden fixtures, and benchmark support.

## Definition of done

1. The change works in the playground.
2. Relevant unit and golden tests pass.
3. Markdown import/export stability is preserved.
4. Undo/redo, selection, and comments are not corrupted.
5. Benchmark p99 does not regress for hot paths.
