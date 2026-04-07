# AGENTS.md

## Mission

Build a markdown-native writing surface that stays rendered, but becomes locally editable at the active block or span. Use `Document` as the semantic truth, `DocumentEditor` as the hot-path editing projection, and Pretext for text measurement and layout intelligence.

## Product principles

- Markdown is the persistence boundary.
- The editing projection is semantic, not raw markdown text.
- Only the active region reveals source-like editing affordances.
- Comments are anchored annotations, not document content.
- Pretext never owns caret, IME, clipboard, undo, or live selection.
- Canvas is the live editor surface.
- The editor must fit and react to the dimensions of its host element.

## Toolchain defaults

- Use Bun as the default package manager, script runner, bundler, and test runner.
- Use `oxlint` and `oxfmt`.
- Keep the playground healthy; it is a required dogfooding surface.

## Writing great code

- Start with the correct layer. Keep logic in the lowest correct subsystem and own it there completely instead of smearing one behavior across component, editor, markdown, and document layers.
- Prefer small, semantic public APIs. Export capabilities in terms of what they mean, not how they are implemented.
- Make files read clearly from top to bottom. Put the main entrypoint first, then the supporting helpers in dependency order.
- Use concise module comments when they help a reader understand the file’s role. Skip boilerplate commentary.
- Choose semantic names for functions, types, and variables. Avoid names that overfit the current implementation detail.
- Keep helper modules only when they earn their keep through clearer ownership, reuse, or simpler reading.
- Prefer declarative tables and small policy objects when they make behavior easier to scan.
- Keep React components focused on lifecycle, DOM integration, rendering, and host concerns. Push semantic editing behavior into `src/editor`.

## Writing great tests

- Test the subsystem that owns the behavior.
- Prefer focused unit coverage over broad UI smoke tests.
- Use markdown golden tests to protect round-trip stability.
- Add or update benchmark coverage when changing layout, paint, viewport planning, or other hot paths.
- Verify the real browser behavior in the playground after meaningful UI changes, especially for input, scrolling, resize, and paint issues.

## Architecture

### Snapshot

`markdown -> Document -> DocumentEditor/editor state -> DocumentLayout -> canvas pixels`

Read that pipeline from left to right:

- `src/markdown` parses persisted markdown into `Document` and serializes `Document` back to canonical markdown.
- `src/document` defines `Document`, the format-agnostic semantic model.
- `src/editor/model` projects `Document` into `DocumentEditor` state, applies semantic editing operations, and produces the next semantic `Document` for history, serialization, and external updates.
- `src/editor/layout` turns `DocumentEditor` plus host viewport facts into `DocumentLayout`, then answers viewport mapping, caret measurement, scrolling, and hit testing against that prepared layout.
- `src/editor/render` paints prepared layout into canvas pixels.
- `src/component` hosts the editor in React, bridges controlled `content` into `Document`, and wires browser events into the editor facade.

In practice there are two hot-path editor projections with different jobs:

- `DocumentEditor` is the editor's editable projection of `Document`. Editing commands and undo/redo operate through editor state built around this projection, then produce the next semantic `Document`.
- `DocumentLayout` is the geometry projection of `DocumentEditor`. Viewport planning, scrolling, caret targeting, and hit testing operate against this prepared layout, and paint consumes it to draw pixels.

Supporting lanes:

- comments persistence and anchor repair
- Pretext-backed measurement and viewport-local layout
- playground diagnostics and benchmark surfaces

### Subsystems

- `src/document`
  The abstract semantic model for the whole system. This layer defines what a `Document` is, which block and inline nodes exist, and which small format-agnostic helpers other subsystems can rely on. It should stay ignorant of markdown syntax, editor projection details, and React.
- `src/markdown`
  The markdown adapter around the semantic document model. This layer parses markdown into `Document`, serializes `Document` back to canonical markdown, and owns markdown-only concerns like source normalization and formatting options.
- `src/editor`
  The framework-agnostic editing engine. This layer turns `Document` into editor state and `DocumentEditor`, applies semantic editing and navigation behavior, turns `DocumentEditor` into `DocumentLayout`, and paints that layout to canvas through a host-facing editor facade without knowing about React lifecycle or markdown strings.
- `src/component`
  The public React host for the editor. This layer bridges controlled `content` into `Document`, wires browser and DOM behavior into the editor facade, manages host metrics and SSR, and exposes the stable `Documint` component surface to consumers.
- `src/comments`
  The anchored annotation lane. This layer owns comment persistence, anchor matching and repair, and the data model for review state without turning comments into document content.
- `playground`
  The dogfooding app for the public component API. Use it to exercise real browser behavior, inspect state and metrics, and catch integration issues that unit tests and benchmarks miss.
- `scripts`
  Repository automation for build, packaging, and benchmarks. Keep this operational code out of `src/` so production library boundaries stay clean.
- `test`
  Unit tests, golden fixtures, and benchmark support. Test the subsystem that owns the behavior, and use this tree to protect semantic round-trips, editor behavior, and performance-sensitive paths.

### Subsystem guides

- Read [src/document/AGENTS.md](/Users/lostintangent/Desktop/documint/src/document/AGENTS.md) before changing the semantic document model.
- Read [src/comments/AGENTS.md](/Users/lostintangent/Desktop/documint/src/comments/AGENTS.md) before changing comment persistence, anchor repair, or review-state semantics.
- Read [src/markdown/AGENTS.md](/Users/lostintangent/Desktop/documint/src/markdown/AGENTS.md) before changing markdown parsing or serialization.
- Read [src/editor/AGENTS.md](/Users/lostintangent/Desktop/documint/src/editor/AGENTS.md) before changing editor state, operations, navigation, layout, hit-testing, or paint.
- Read [src/component/AGENTS.md](/Users/lostintangent/Desktop/documint/src/component/AGENTS.md) before changing the React host, SSR surface, or DOM integration.

### Boundaries

- `src/document` is the abstract semantic document model for the whole system. It must stay format-agnostic so markdown is only one adapter, not a baked-in assumption.
- `src/markdown` adapts markdown to and from `Document`.
- `src/editor` operates on `Document`, not markdown strings.
- `src/component` bridges `content <-> Document`, owns host lifecycle and browser facts, and should not re-own editor semantics, viewport policy, hit testing, or paint logic.
- Low-level render and layout primitives stay inside `src/editor`; the package root should expose stable component, document, theme, and comments APIs instead of raw render internals.
- Large documents should do the minimum necessary work: viewport-local layout and paint plus bounded reuse of measured artifacts.

## Definition of done

1. The change works in the playground.
2. Relevant unit and golden tests pass.
3. Markdown import/export stability is preserved.
4. Undo/redo, selection, and comments are not corrupted.
5. Resize behavior is verified when host geometry changes.
6. Benchmarks do not regress materially for hot paths.
