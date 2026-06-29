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

- `index.ts` owns budgeted script orchestration, full-suite warmup, repeated-run pass/fail rules, and scenario-id/budget validation.
- `fixtures.ts` owns benchmark fixture loading, parsed document snapshots, and synthetic long/xlarge/huge documents.
- `harness.ts` owns the benchmark scenario and scenario-run types, viewport constants, warmup loop, and timed sample runner.
- `stats.ts` owns sample sorting and nearest-rank percentile calculation.
- `gate.ts` owns budget validation and repeated-run failure collection.
- `output.ts` owns table/JSON projection.
- `manifest.json` owns fixture paths and budget thresholds for the budgeted scripts.
- `scenarios/markdown.ts`, `scenarios/layout.ts`, `scenarios/editor.ts`, and `scenarios/component.ts` own subsystem-specific budgeted workloads.
- `moby-dick.ts` owns the large-document profiler, including source text fetch/cache, markdown normalization, open-path profiles, scroll/layout/paint samples, and edit-path samples.
