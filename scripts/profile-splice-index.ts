// TEMPORARY HARNESS — profile the typing hot path to decompose `insertText`
// latency on long documents.
//
// Goal: answer two questions empirically:
//
//   Q1. What fraction of total typing latency is `spliceDocumentIndex`?
//   Q2. Within `spliceDocumentIndex`, what fraction is the map rebuild
//       (`createResolvedDocumentIndex`) vs. the per-root projection work?
//
// Approach: replay a same-region text insert at multiple layers of granularity
// using the public API. Compare against `createDocumentIndex(nextDocument)` —
// the worst-case full reindex (what undo/redo currently pays).
//
// Run:
//   bun run scripts/profile-splice-index.ts
//
// Delete this file when the question has been answered.

import "../test/setup-canvas";
import { mapBlockTree, spliceDocument, type Document } from "@/document";
import { parseDocument } from "@/markdown";
import {
  createDocumentIndex,
  createEditorState,
  insertText,
  setSelection,
  spliceDocumentIndex,
  type DocumentIndex,
  type EditorState,
} from "@/editor/state";
import { spliceText } from "@/editor/state/reducer/text";
import {
  createRootEntry,
  positionRootEntries,
  rebuildRootEntry,
} from "@/editor/state/index/roots";
import { buildSyntheticLongFixture, readBenchmarkFixtureMarkdown } from "@test/utils";

type Phase = {
  name: string;
  samples: number[];
};

type Scenario = {
  description: string;
  build: () => EditorState;
  blockCount: number;
};

const ITERATIONS = 200;
const WARMUP = 20;

const fixtures = await loadFixtures();
const scenarios: Scenario[] = [
  buildScenario("medium ", fixtures.mediumMarkdown),
  buildScenario("long   ", fixtures.longMarkdown),
  buildScenario("xlarge ", fixtures.xlargeMarkdown),
  buildScenario("huge   ", fixtures.hugeMarkdown),
];

console.log("\n=== insertText decomposition (microseconds; p50 / p99) ===\n");

const phaseLabels = [
  "total",
  "spliceText",
  "replaceBlk",
  "spliceIdx",
  "splicePrelude",
  "createIdx(full)",
  "fullPrelude",
];

const header =
  ["scenario", "blocks", ...phaseLabels].map((s) => s.padStart(14)).join(" | ");
console.log(header);
console.log("-".repeat(header.length));

for (const scenario of scenarios) {
  const phases = profileScenario(scenario);
  printScenarioRows(scenario, phases);
}

console.log(
  "\nLegend:\n" +
    "  total           = full `insertText(state, ' updated')` (user-felt latency)\n" +
    "  spliceText      = reducer/text.ts:spliceText — doc mutation + reindex + comment repair\n" +
    "  replaceBlk      = replaceEditorBlock alone — rebuild affected root, return new Document\n" +
    "  spliceIdx       = spliceDocumentIndex alone — reindex given a rebuilt Document\n" +
    "  splicePrelude   = the splice's per-root work + positionRootEntries positioning, no maps\n" +
    "  createIdx(full) = createDocumentIndex(nextDocument) — worst case (undo/redo path)\n" +
    "  fullPrelude     = N × createRootEntry + positionRootEntries positioning, no maps\n" +
    "\nDerived insights:\n" +
    "  spliceIdx − splicePrelude   ≈ time in createResolvedDocumentIndex (maps) on hot path\n" +
    "  createIdx(full) − fullPrelude ≈ time in createResolvedDocumentIndex (maps) on cold path\n" +
    "  spliceIdx / total           ≈ fraction of typing latency in reindexing\n" +
    "  If (spliceIdx − splicePrelude) is the dominant share of spliceIdx, then the\n" +
    "  TODO in index/build.ts:321 (incremental same-count splice maps) is worth pursuing.\n",
);

// --- Append-trailing-root scenarios ------------------------------------------
//
// Question: does the `appendDocumentIndexRoot` fast path
// (`build.ts:329-387`, with its 6 `appendXIndex` helpers) earn its keep
// versus letting `spliceDocumentIndex` fall through to its general
// `createResolvedDocumentIndex` path?
//
// Trigger conditions for the fast path (read off `spliceDocumentIndex`):
//   rootIndex === model.roots.length  AND  replacementCount === 1
// i.e. a single new trailing root with no removal. We replay exactly that
// here: take the parsed doc, lop off the last root to form a "base," then
// `spliceDocumentIndex(base, full, N, 0)`. That call hits the fast path.
//
// We can't measure "what would happen without the fast path" directly —
// `createResolvedDocumentIndex` isn't exported — so we measure the
// components a general path would do (`createRootEntry` + reusing
// `positionRootEntries`) plus an estimate of the map-rebuild cost taken from
// the cold path (`createIdx(full) − fullPrelude` on the same N+1 doc).
// That gives an upper bound on what deleting the fast path would cost.

type AppendScenario = {
  description: string;
  blockCount: number;
  build: () => { baseIndex: DocumentIndex; fullDoc: Document };
};

type AppendSample = {
  appendFast: number;
  coldRebuild: number;
  manualPrelude: number;
  fullPrelude: number;
};

const appendPhaseLabels = [
  "appendFast",
  "manualPrelude",
  "coldRebuild",
  "fullPrelude",
  "est.general",
];

const appendScenarios: AppendScenario[] = [
  buildAppendScenario("medium ", fixtures.mediumMarkdown),
  buildAppendScenario("long   ", fixtures.longMarkdown),
  buildAppendScenario("xlarge ", fixtures.xlargeMarkdown),
  buildAppendScenario("huge   ", fixtures.hugeMarkdown),
];

console.log("\n=== append-trailing-root decomposition (microseconds; p50 / p99) ===\n");

const appendHeader = ["scenario", "blocks", ...appendPhaseLabels]
  .map((s) => s.padStart(14))
  .join(" | ");
console.log(appendHeader);
console.log("-".repeat(appendHeader.length));

for (const scenario of appendScenarios) {
  const phases = profileAppendScenario(scenario);
  printAppendRows(scenario, phases);
}

console.log(
  "\nAppend-scenario legend:\n" +
    "  appendFast    = spliceDocumentIndex(base, full, N, 0) — current fast path\n" +
    "  manualPrelude = createRootEntry(new) + positionRootEntries([...base, new], base)\n" +
    "                  — the per-root + positioning work the general path would do\n" +
    "  coldRebuild   = createDocumentIndex(full) — strict ceiling on general-path cost\n" +
    "  fullPrelude   = (N+1) × createRootEntry + positionRootEntries, no maps\n" +
    "                  — same denominator the existing decomposition uses\n" +
    "  est.general   = manualPrelude + (coldRebuild − fullPrelude)\n" +
    "                  — estimated cost of the general splice path if the fast path\n" +
    "                    branch were deleted. Reuses N positioned roots from `base`,\n" +
    "                    but still rebuilds all maps from scratch.\n" +
    "\nDecision:\n" +
    "  est.general − appendFast = the regression deleting the fast path would cause\n" +
    "  on this specific input shape. The fast path doesn't fire on any other shape,\n" +
    "  so this is the maximum cost it's saving anywhere.\n",
);

function buildAppendScenario(label: string, markdown: string): AppendScenario {
  const fullDoc = parseDocument(markdown);
  if (fullDoc.blocks.length < 2) {
    throw new Error("append scenario needs at least 2 root blocks");
  }
  const baseDoc = spliceDocument(fullDoc, fullDoc.blocks.length - 1, 1, []);
  return {
    description: label,
    blockCount: fullDoc.blocks.length,
    build: () => ({ baseIndex: createDocumentIndex(baseDoc), fullDoc }),
  };
}

function profileAppendScenario(scenario: AppendScenario): Phase[] {
  const phases: Phase[] = appendPhaseLabels.map((name) => ({ name, samples: [] }));

  for (let i = 0; i < WARMUP; i += 1) {
    runAppendShot(scenario);
  }

  for (let i = 0; i < ITERATIONS; i += 1) {
    const sample = runAppendShot(scenario);
    phases[0]!.samples.push(sample.appendFast);
    phases[1]!.samples.push(sample.manualPrelude);
    phases[2]!.samples.push(sample.coldRebuild);
    phases[3]!.samples.push(sample.fullPrelude);
    phases[4]!.samples.push(
      sample.manualPrelude + Math.max(0, sample.coldRebuild - sample.fullPrelude),
    );
  }

  for (const phase of phases) {
    phase.samples.sort((a, b) => a - b);
  }

  return phases;
}

function runAppendShot(scenario: AppendScenario): AppendSample {
  const { baseIndex, fullDoc } = scenario.build();
  const N = baseIndex.roots.length;
  const newBlock = fullDoc.blocks[N]!;

  // 1. Current append fast path
  const t0 = performance.now();
  void spliceDocumentIndex(baseIndex, fullDoc, N, 0);
  const t1 = performance.now();

  // 2. Cold rebuild — strict upper bound on general-path cost (no root reuse)
  const t2 = performance.now();
  void createDocumentIndex(fullDoc);
  const t3 = performance.now();

  // 3. Manual prelude — what the general splice path would do before
  //    createResolvedDocumentIndex: build one new root, position with reuse.
  const t4 = performance.now();
  const newRoot = createRootEntry(newBlock, N);
  void positionRootEntries([...baseIndex.roots, newRoot], baseIndex.roots);
  const t5 = performance.now();

  // 4. Full cold prelude on the same N+1 doc, for deriving cold map cost.
  const t6 = performance.now();
  const allRoots = fullDoc.blocks.map((b, i) => createRootEntry(b, i));
  void positionRootEntries(allRoots);
  const t7 = performance.now();

  return {
    appendFast: usec(t0, t1),
    coldRebuild: usec(t2, t3),
    manualPrelude: usec(t4, t5),
    fullPrelude: usec(t6, t7),
  };
}

function printAppendRows(scenario: AppendScenario, phases: Phase[]) {
  const p50 = phases.map((phase) => percentile(phase.samples, 0.5));
  const p99 = phases.map((phase) => percentile(phase.samples, 0.99));
  const blockStr = String(scenario.blockCount).padStart(6);

  const row50 = ["p50  " + scenario.description, blockStr, ...p50.map(fmt)]
    .map((s) => String(s).padStart(14))
    .join(" | ");
  const row99 = ["p99  " + scenario.description, blockStr, ...p99.map(fmt)]
    .map((s) => String(s).padStart(14))
    .join(" | ");

  console.log(row50);
  console.log(row99);
}

// --- Implementation ---------------------------------------------------------

type Sample = {
  total: number;
  spliceText: number;
  replaceBlk: number;
  spliceIdx: number;
  splicePrelude: number;
  createIdxFull: number;
  fullPrelude: number;
};

function profileScenario(scenario: Scenario): Phase[] {
  const phases: Phase[] = phaseLabels.map((name) => ({ name, samples: [] }));

  for (let i = 0; i < WARMUP; i += 1) {
    runOneShot(scenario);
  }

  for (let i = 0; i < ITERATIONS; i += 1) {
    const sample = runOneShot(scenario);
    phases[0]!.samples.push(sample.total);
    phases[1]!.samples.push(sample.spliceText);
    phases[2]!.samples.push(sample.replaceBlk);
    phases[3]!.samples.push(sample.spliceIdx);
    phases[4]!.samples.push(sample.splicePrelude);
    phases[5]!.samples.push(sample.createIdxFull);
    phases[6]!.samples.push(sample.fullPrelude);
  }

  for (const phase of phases) {
    phase.samples.sort((a, b) => a - b);
  }

  return phases;
}

function runOneShot(scenario: Scenario): Sample {
  const state = scenario.build();
  const text = " updated";

  // --- 1. total insertText (the user-felt latency) ---
  const t0 = performance.now();
  const nextState = insertText(state, text);
  const t1 = performance.now();
  if (!nextState) throw new Error("insertText returned null");

  // --- 2. spliceText directly ---
  const t2a = performance.now();
  const spliceResult = spliceText(state.documentIndex, state.selection, text);
  const t2b = performance.now();
  void spliceResult;

  // --- 3. replaceBlk: rebuild the affected root and emit a new Document.
  // Mirrors what `replaceEditorBlock` used to time-share with `spliceIdx`:
  // we deliberately call the underlying primitives directly here so that
  // step #3 keeps measuring "Document rebuild" in isolation. (The new
  // `replaceEditorBlock` returns a `DocumentIndex` directly.)
  const region = state.documentIndex.regionIndex.get(state.selection.focus.regionId)!;
  const blockId = region.block.id;
  const rootBlock = state.documentIndex.document.blocks[region.rootIndex]!;

  const t3a = performance.now();
  const nextRoots = mapBlockTree([rootBlock], (block, { recurse }) =>
    block.id === blockId ? block : recurse(),
  );
  const nextDocument = spliceDocument(
    state.documentIndex.document,
    region.rootIndex,
    1,
    nextRoots,
  );
  const t3b = performance.now();

  // --- 4. spliceDocumentIndex on the rebuilt Document ---
  const t4a = performance.now();
  const nextIdx = spliceDocumentIndex(state.documentIndex, nextDocument, region.rootIndex, 1);
  const t4b = performance.now();
  void nextIdx;

  // --- 5. splicePrelude: the same per-root rebuild + positioning that
  // spliceDocumentIndex does internally, WITHOUT calling createResolvedDocumentIndex.
  // The delta (#4 − #5) ≈ time spent in createResolvedDocumentIndex on the splice path.
  const t5a = performance.now();
  const replacedRoot = rebuildRootEntry(
    state.documentIndex.roots[region.rootIndex]!,
    nextDocument.blocks[region.rootIndex]!,
  );
  const splicedRoots = [
    ...state.documentIndex.roots.slice(0, region.rootIndex),
    replacedRoot,
    ...state.documentIndex.roots.slice(region.rootIndex + 1),
  ];
  void positionRootEntries(splicedRoots, state.documentIndex.roots);
  const t5b = performance.now();

  // --- 6. createDocumentIndex(nextDocument) — full reindex baseline ---
  const t6a = performance.now();
  const fullIdx = createDocumentIndex(nextDocument);
  const t6b = performance.now();
  void fullIdx;

  // --- 7. fullPrelude: N × createRootEntry + positionRootEntries, no maps.
  // The delta (#6 − #7) ≈ time spent in createResolvedDocumentIndex on the cold path.
  const t7a = performance.now();
  const allRoots = nextDocument.blocks.map((block, rootIndex) =>
    createRootEntry(block, rootIndex),
  );
  void positionRootEntries(allRoots);
  const t7b = performance.now();

  return {
    total: usec(t0, t1),
    spliceText: usec(t2a, t2b),
    replaceBlk: usec(t3a, t3b),
    spliceIdx: usec(t4a, t4b),
    splicePrelude: usec(t5a, t5b),
    createIdxFull: usec(t6a, t6b),
    fullPrelude: usec(t7a, t7b),
  };
}

function buildScenario(label: string, markdown: string): Scenario {
  const snapshot = parseDocument(markdown);
  return {
    description: label,
    blockCount: snapshot.blocks.length,
    build: () => positionInMiddleTextRegion(createEditorState(snapshot)),
  };
}

function positionInMiddleTextRegion(state: EditorState): EditorState {
  const regions = state.documentIndex.regions.filter((region) => region.text.length > 0);
  const region = regions[Math.floor(regions.length / 2)];
  if (!region) throw new Error("Expected a non-empty region");
  return setSelection(state, {
    regionId: region.id,
    offset: Math.floor(region.text.length / 2),
  });
}

async function loadFixtures() {
  const mediumMarkdown = await readBenchmarkFixtureMarkdown("full-spectrum");
  const longMarkdown = buildSyntheticLongFixture(mediumMarkdown, 90);
  const xlargeMarkdown = buildSyntheticLongFixture(mediumMarkdown, 180);
  const hugeMarkdown = buildSyntheticLongFixture(mediumMarkdown, 360);
  return { mediumMarkdown, longMarkdown, xlargeMarkdown, hugeMarkdown };
}

function usec(start: number, end: number): number {
  return (end - start) * 1000;
}

function percentile(sortedSamples: number[], fraction: number): number {
  const index = Math.min(
    sortedSamples.length - 1,
    Math.max(0, Math.ceil(sortedSamples.length * fraction) - 1),
  );
  return sortedSamples[index]!;
}

function fmt(usec: number): string {
  if (Number.isNaN(usec) || !Number.isFinite(usec)) return "    n/a";
  if (usec < 0) return "    neg";
  if (usec < 1000) return `${usec.toFixed(1)}us`;
  return `${(usec / 1000).toFixed(2)}ms`;
}

function printScenarioRows(scenario: Scenario, phases: Phase[]) {
  const p50 = phases.map((phase) => percentile(phase.samples, 0.5));
  const p99 = phases.map((phase) => percentile(phase.samples, 0.99));

  const blockStr = String(scenario.blockCount).padStart(6);

  const row50 = ["p50  " + scenario.description, blockStr, ...p50.map(fmt)]
    .map((s) => String(s).padStart(14))
    .join(" | ");
  const row99 = ["p99  " + scenario.description, blockStr, ...p99.map(fmt)]
    .map((s) => String(s).padStart(14))
    .join(" | ");

  console.log(row50);
  console.log(row99);
}
