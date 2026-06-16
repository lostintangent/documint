# Component Decorations

The decorations subsystem renders prose styling and code syntax highlighting without changing document content. Decorations are render-only, unlike formatting marks such as bold or italic. Hosts can add regex-based styling to prose ranges, while code blocks get grammar-based token colors that become cached `TextDecoration` ranges for rendering.

## Design Notes

- **Worker classification keeps typing non-blocking.** Regex compilation, prose matching, and code-source tokenization run in the worker so typing does not wait on classification. Worker messages carry `configKey`s and root source keys so async results stay reliable under rapid edits, theme changes, and external document replacement.
- **Edits stay responsive through staged updates.** Decoration computation classifies the full document up front, external replacements refresh everything, source text edits remap ranges and classify affected roots immediately, and other local document changes batch affected-root work for 220ms so typing stays ahead of worker classification.
- **Worker failures fail closed and restart later.** A timed-out or failed decoration job clears the cached decorations and drops the dead worker client, so the next configured job creates a fresh worker instead of keeping stale or partially classified ranges on screen.
- **Region-relative caches make scroll cheap.** Decorations are stored as region-relative offsets, not viewport geometry. Scrolling reuses the cached `TextDecoration` index and lets frame construction plus canvas transforms place visible ranges.
- **One paint shape keeps decoration sources extensible.** Prose matches and code grammar highlights both become `TextDecoration`s, so new prose rules or grammar token colors can share the same paint path. The component resolves host rules, language aliases, and theme-dependent grammar tokens before worker jobs. The worker stays focused on pure classification over concrete decoration rules. Host prose rules and code token rules currently target separate region paths. Code-targeting host rules would need an explicit layering rule.

## Subsystem Map

- `worker/` owns off-thread classification: regex compilation, prose matching, code-source tokenization, and the worker runtime entrypoint.
- `client/` owns UI-thread configuration, worker communication, root snapshots, result reconciliation, and provisional edit remapping.
- `useDecorations.ts` owns the React entrypoint: it observes editor transitions, chooses refresh vs. affected-root updates, and publishes the cached `TextDecoration` index back to `Documint`.
- `grammars/` owns built-in grammar definitions, language normalization, and token-to-decoration configuration.
- `shared.ts` owns types shared by the UI client, worker, and reconciliation path.

## Known Limitations

- **Oversized code blocks render plain.** Large code blocks skip grammar tokenization to bound worst-case worker cost and keep typing responsive. Raise that limit only with profiling that shows classification still stays off the editing hot path.
