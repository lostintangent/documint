# Component Decorations

The decorations subsystem renders prose styling and code syntax highlighting without changing document content. Decorations are render-only, unlike formatting marks such as bold or italic. Hosts can add regex-based styling to prose ranges, while code blocks get grammar-based token colors that become cached `TextDecoration` ranges for rendering.

## Design Notes

- **Worker classification keeps typing non-blocking.** Regex compilation, prose matching, and code-source tokenization run in the worker so typing does not wait on classification. The UI sends concrete prose rules, grammar token rules, and root snapshots. The worker returns ranges only.
- **Prose rules classify editor text, not semantic anchors.** Host regex rules run over editor inline ranges and keep their own eligibility policy: unmarked top-level text is matchable, while links, marks, references, raw inlines, line breaks, and code/source blocks are skipped. The worker uses editor runtime offsets so returned ranges line up with selection, layout, and paint.
- **Changed roots drive incremental invalidation.** Decoration computation classifies the full document up front, external replacements refresh everything, source text edits remap ranges and classify affected roots immediately, and other local document changes batch affected-root work for 220ms. Results apply only when their `configKey` and root source keys still match the current editor state, so stale worker replies are ignored.
- **Worker failures clear stale decoration ranges.** A timed-out or failed decoration job clears the cached decorations and drops the dead worker client, so the next configured job creates a fresh worker instead of keeping stale or partially classified ranges on screen.
- **Path-relative caches make scroll cheap.** Decorations are stored as offsets at block or table-cell paths, not viewport geometry. Scrolling reuses the cached `TextDecoration` index and lets frame construction plus canvas transforms place visible ranges.
- **One paint shape keeps decoration sources extensible.** Prose matches and code grammar highlights both become `TextDecoration`s, so new prose rules or grammar token colors can share the same paint path. The component resolves host rules, language aliases, and theme-dependent grammar tokens before worker jobs. The worker stays focused on pure classification over concrete decoration rules.

## Subsystem Map

- `worker/` owns off-thread classification: regex compilation, prose matching, code-source tokenization, and the worker runtime entrypoint.
- `client/` owns UI-thread configuration, worker communication, root snapshots, result reconciliation, and provisional edit remapping.
- `useDecorations.ts` owns the React entrypoint: it observes editor transitions, chooses refresh vs. affected-root updates, and publishes the cached `TextDecoration` index back to `Documint`.
- `grammars/` owns built-in grammar definitions, language normalization, and token-to-decoration configuration.
- `shared.ts` owns types shared by the UI client, worker, and reconciliation path.

## Known Limitations

- **Oversized code blocks render plain.** Large code blocks skip grammar tokenization to bound worst-case worker cost and keep typing responsive. Raise that limit only with profiling that shows classification still stays off the editing hot path.
- **Host prose rules do not target code blocks yet.** Host prose rules and code token rules currently classify separate paths. Code-targeting host rules need an explicit layering policy for overlaps between host styling and grammar tokens. Add that policy when hosts need code-specific styling beyond grammar token colors.
