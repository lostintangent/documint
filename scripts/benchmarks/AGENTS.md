# Benchmarks

The benchmark scripts are Documint's local performance spec for markdown translation, editor state, layout, component sync, and large-document rendering. `bun benchmark` checks selected workloads against budgets. `benchmark:moby-dick` is a secondary stress test for performance on a huge document.

## Design Notes

- **Budget checks filter local-machine noise.** Benchmarks run one discarded full-suite warmup, then three measured suites, and fail only after more than one over-budget measured run. The signal is repeated p99 pressure, not cold-start work or one slow sample.
- **The reported p99 uses nearest-rank samples.** Small iteration counts can make p99 behave like the slowest sample, so budget headroom and iteration count are coupled.
- **High-variance scenarios stay in the gate with larger samples.** If a scenario is product-relevant but repeatedly fails on isolated scheduler/GC spikes, prefer raising its iteration count so p99 is not just the maximum sample. Quarantine or budget widening should be explicit last resorts because they weaken regression signal.
- **Scenarios encode product-shaped workloads.** They assemble documents, editor states, selections, layout caches, decoration rules, sync fixtures, and sometimes batches of edits or scroll offsets around real editor pressure points. The budget belongs to the measured scenario as written.
- **Fixtures and geometry define the workload.** Golden markdown, synthetic repetition counts, viewport size, scroll offsets, caches, and canvas metrics are benchmark inputs.
- **Budget names are stable keys.** Scenario ids and manifest budget ids must move together; renames are budget migrations, not cosmetic edits.

## Subsystem Map

- `index.ts` owns budgeted script orchestration, scenario groups and suite order, scenario-id/budget validation, full-suite warmup, repeated-run pass/fail rules, and table output.
- `fixtures.ts` owns benchmark fixture loading, parsed document snapshots, and synthetic long/xlarge/huge documents.
- `harness.ts` owns the benchmark scenario and scenario-run types, the shared viewport, warmup loop, timed sample runner, nearest-rank percentiles, and the document frame both scripts paint.
- `manifest.json` owns budget thresholds, grouped by scenario module.
- `scenarios/markdown.ts`, `scenarios/layout.ts`, `scenarios/editor.ts`, and `scenarios/component.ts` own subsystem-specific budgeted workloads.
- `moby-dick.ts` owns the large-document profiler, including source text fetch/cache, markdown normalization, open-path profiles, scroll/layout/paint samples, and edit-path samples.

## Known Limitations

- **Budgets assume a quiet machine.** The repeated-run rule absorbs isolated spikes, but sustained load from builds, browsers, or other agents can push even an untouched scenario over budget on every run. That is acceptable while benchmarks run locally on demand, so rerun once on a quieter machine before treating such a failure as a regression. If false failures become routine, the gate needs a dedicated runner or a same-machine baseline instead of absolute budgets.
