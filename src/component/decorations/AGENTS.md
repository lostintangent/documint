# Component Decorations

The decorations subsystem gives users lightweight visual feedback that is not
part of the document itself. Hosts can mark prose ranges for search,
suggestions, warnings, or other transient meaning, and code blocks can gain
syntax coloring without changing markdown content or editor semantics.

Decorations consume host rules, code grammars, and editor root snapshots. The
worker classifies affected roots, reconciliation updates the cached
`TextDecoration` index, and frame construction passes those ranges to the
renderer. The editor owns region paths and offsets; the renderer owns turning
those ranges into pixels.

## Design Notes

- **Worker classification keeps typing non-blocking.** Regex compilation, prose
  matching, and code-source tokenization run in the worker so typing does not
  wait on classification. Worker messages carry `configKey`s and root source
  keys so async results stay reliable under rapid edits, theme changes, and
  external document replacement. Oversized code blocks render plain to bound
  worst-case tokenization work.
- **Edits stay responsive through incremental classification.** Decoration
  computation classifies the full document up front, then local edits send only
  affected roots to the worker and preserve cached ranges for unrelated region
  paths. Simple single-region text edits remap existing ranges immediately while
  fresh classification catches up.
- **Region-relative caches make scroll cheap.** Decorations are stored as
  region-relative offsets, not viewport geometry. Scrolling reuses the cached
  `TextDecoration` index and lets frame construction plus canvas transforms
  place visible ranges.
- **Extensible without renderer changes.** Prose matches and code grammar
  highlights both become `TextDecoration`s, so new decoration sources can share
  the same paint path. The component resolves host rules, language aliases, and
  theme-dependent grammar tokens before worker jobs; the worker stays focused on
  pure classification over concrete decoration rules.

## Subsystem Map

- `worker/` owns off-thread classification: regex compilation, prose matching,
  code-source tokenization, and the worker runtime entrypoint.
- `client/` owns UI-thread configuration, worker communication, root snapshots,
  result reconciliation, and provisional edit remapping.
- `useDecorations.ts` owns the React entrypoint: it observes editor
  transitions, chooses refresh vs. affected-root updates, and publishes the
  cached `TextDecoration` index back to `Documint`.
- `grammars/` owns built-in grammar definitions, language normalization, and
  token-to-decoration configuration.
- `shared.ts` owns types shared by the UI client, worker, and reconciliation
  path.
