# Benchmark Harness Cleanup

## Current Direction

The budgeted benchmark harness should stay a high-signal budget check, not a data-analysis framework.

`bun benchmark` answers one question: did each benchmark's p99 stay under its budget often enough to pass the three-run local-noise policy?

The useful structure is intentionally small:

- `index.ts` orchestrates fixture loading, scenario creation, repeated suite runs, output, and failure reporting.
- `harness.ts` owns the warmup loop, timed sample loop, scenario type, viewport constants, and p50/p95/p99 measurement.
- `fixtures.ts` owns fixture loading, parsing, and synthetic long/xlarge/huge documents.
- `gate.ts` owns duplicate/missing/unused budget validation and repeated-run failure collection.
- `output.ts` owns the minimal table/JSON projection.
- `scenarios/` owns the markdown, layout, component, and editor benchmark definitions.
- `moby-dick.ts` remains a separate huge-document profiler, not part of the budgeted gate.

## Design Decisions

- Scenario ids are the stable budget keys. They must match `manifest.json` exactly.
- The default table and JSON output should stay minimal: benchmark id, p50, p95, p99, budget, and pass/fail state.
- Warmups, group names, sample kinds, max values, machine metadata, and workload fingerprints do not belong in the default budgeted output.
- Table-driving is useful only for mechanically uniform benchmark families. Editor and component scenarios should stay explicit where the setup explains the hot path.
- Moby-Dick may keep richer profiler-specific records because it mixes open-path, scroll-offset, paint, and edit measurements.
