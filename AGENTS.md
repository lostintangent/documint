# Documint (Architecture + Contribution Guidelines)

## Architectural overview

Documint is a layered editor built around a functional core with explicit edge effects. Content flows through one main pipeline:

`markdown → Document → EditorState → EditorLayoutState → renderer → pixels`

Each layer owns one transition and builds on the immutable output of the layer before it: markdown produces semantic `Document` values; document/indexing produces runtime `EditorState`; layout produces geometry in `EditorLayoutState`; renderer consumes state, layout, resources, theme, and time to produce pixels. Lower layers should not reach upward for orchestration concerns, and higher layers should not re-implement lower-layer semantics.

The durable values (`Document`, `EditorState`, `EditorLayoutState`) are immutable snapshots. Mutations return new snapshots with structural sharing: unchanged roots, indexes, selections, and layout artifacts keep reference identity whenever possible so downstream caches can prove what did not change. Most subsystems are pure transformations or queries over those snapshots and should answer entirely from their provided inputs.

Effects are explicit boundaries. DOM/canvas measurement, `requestAnimationFrame`, browser events, image loading, mutable layout caches, and canvas drawing are owned by `src/component` or clearly marked browser-facing helpers. Clock-bearing APIs should accept caller-provided time for deterministic callers, even when they provide convenience defaults. The engine may consume those inputs, but it should not smuggle long-lived mutable state into `Document`, `EditorState`, or `EditorLayoutState`.

## Subsystems

Each subsystem has its own `AGENTS.md` for local rules and ownership. Use this map to choose the correct layer, then read that subsystem guide before editing.

- [`src/document`](src/document/AGENTS.md) - Semantic document truth: immutable block/inline trees, canonical IDs, plain-text projections, paths, queries, and comment threads as anchored annotations.
- [`src/markdown`](src/markdown/AGENTS.md) - File and clipboard boundary: direct `markdown → Document → markdown` parsing, serialization, fragments, front matter, tables, and comment directives.
- [`src/editor`](src/editor/AGENTS.md) - Framework-agnostic editor engine: document indexing, state, commands, selection, navigation, anchors, layout, hit testing, and text measurement.
- [`src/renderer`](src/renderer/AGENTS.md) - Immediate-mode painting from prepared editor/layout inputs to canvas pixels.
- [`src/component`](src/component/AGENTS.md) - React/browser host: content bridging, orchestration, effects, image loading, render scheduling, hooks, overlays, and leaf UI.
- `playground` - Dogfooding app for real browser behavior.
- `scripts` - Build, packaging, benchmark, and automation scripts.
- `test` - Unit tests, golden fixtures, and benchmark support.

## Runtime cadence

The pipeline stages run at different cadences. `markdown ↔ Document` happens at file and clipboard boundaries. `Document → EditorState` creates a new immutable state for mutations and selection moves. `EditorState → EditorLayoutState` is lazily recomputed only when layout-affecting inputs change: edits the cache cannot cover, scroll, or surface resize.

Selection moves, animation ticks, and caret blinks reuse cached layout. Editor actions emit semantic effects such as `{ kind, ...identifiers }`; the component host attaches runtime start times, and paint resolves the current frame from `now`. The component host owns the coalesced `requestAnimationFrame` scheduler: interactions request paints, in-flight animations self-schedule content paints, and the 530ms caret blink repaints only the overlay.

## Writing great code

- Start with the correct layer and keep behavior owned there.
- Preserve immutable data and structural sharing; selection moves should keep the same `documentIndex`, and unchanged roots/layout artifacts should keep identity when possible.
- Keep model changes and queries deterministic over their inputs where practical. Thread clocks, resources, caches, and browser effects in explicitly when determinism matters.
- Favor declarative data over imperative APIs without over-abstracting: animations are descriptors, commands are state-to-state transforms, and layout/paint policies belong in tables or small policy objects.
- Prefer small, semantic public APIs that describe what they mean, not how they are implemented.
- Make files read top-to-bottom: main entrypoint first, helpers in dependency order.
- Use comments only for file roles, non-obvious invariants, or complex logic.
- Choose semantic names and add helper modules only when they clarify ownership, reuse, or reading.

## Writing great tests

- Test the subsystem that owns the behavior.
- Prefer focused unit coverage over broad UI smoke tests.
- Use markdown golden tests to protect round-trip stability.
- Add or update benchmark coverage when changing layout, paint, viewport planning, or other hot paths.
- Verify real browser behavior in the playground after meaningful UI changes, especially for input, scrolling, resize, and paint issues.
- Group tests logically with `describe` blocks, ordered common-case-first → edge-case-last; order tests within each group the same way.
- Put helpers in the lowest subsystem they apply to (`test/document/`, `test/markdown/`, `test/editor/`, `test/renderer/`). Higher subsystems may import from lower ones, never the other way around.

## Definition of done

1. The change works in the playground when browser behavior is involved.
1. Relevant unit and golden tests pass.
1. Markdown import/export stability is preserved.
1. Undo/redo, selection, and comments are not corrupted.
1. Benchmark p99 does not regress for hot paths.
1. Relevant subsystem `AGENTS.md` files are updated when design intent, ownership, or file/folder roles change, using `AGENTS.md.template` as the writing standard.
