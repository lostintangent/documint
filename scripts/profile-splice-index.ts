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
import { parseDocument } from "@/markdown";
import {
  createDocumentIndex,
  createEditorState,
  insertText,
  setSelection,
  spliceDocumentIndex,
  buildEditorRoots,
  createEditorRoot,
  rebuildEditorRoot,
  type EditorState,
} from "@/editor/state";
import { spliceText } from "@/editor/state/reducer/text";
import { replaceEditorBlock } from "@/editor/state/index/build";
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
    "  splicePrelude   = the splice's per-root work + buildEditorRoots positioning, no maps\n" +
    "  createIdx(full) = createDocumentIndex(nextDocument) — worst case (undo/redo path)\n" +
    "  fullPrelude     = N × createEditorRoot + buildEditorRoots positioning, no maps\n" +
    "\nDerived insights:\n" +
    "  spliceIdx − splicePrelude   ≈ time in createResolvedDocumentIndex (maps) on hot path\n" +
    "  createIdx(full) − fullPrelude ≈ time in createResolvedDocumentIndex (maps) on cold path\n" +
    "  spliceIdx / total           ≈ fraction of typing latency in reindexing\n" +
    "  If (spliceIdx − splicePrelude) is the dominant share of spliceIdx, then the\n" +
    "  TODO in index/build.ts:321 (incremental same-count splice maps) is worth pursuing.\n",
);

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

  // --- 3. replaceEditorBlock alone ---
  // For the single-region splice path this is what spliceText calls first.
  // We pass an identity replacer; replaceEditorBlock still walks the path via
  // mapBlockTree and emits a fresh Document, so timing is faithful.
  const region = state.documentIndex.regionIndex.get(state.selection.focus.regionId)!;
  const blockId = region.blockId;

  const t3a = performance.now();
  const nextDocument = replaceEditorBlock(state.documentIndex, blockId, (block) => block);
  const t3b = performance.now();
  if (!nextDocument) throw new Error("replaceEditorBlock returned null");

  // --- 4. spliceDocumentIndex on the rebuilt Document ---
  const t4a = performance.now();
  const nextIdx = spliceDocumentIndex(state.documentIndex, nextDocument, region.rootIndex, 1);
  const t4b = performance.now();
  void nextIdx;

  // --- 5. splicePrelude: the same per-root rebuild + positioning that
  // spliceDocumentIndex does internally, WITHOUT calling createResolvedDocumentIndex.
  // The delta (#4 − #5) ≈ time spent in createResolvedDocumentIndex on the splice path.
  const t5a = performance.now();
  const replacedRoot = rebuildEditorRoot(
    state.documentIndex.roots[region.rootIndex]!,
    nextDocument.blocks[region.rootIndex]!,
  );
  const splicedRoots = [
    ...state.documentIndex.roots.slice(0, region.rootIndex),
    replacedRoot,
    ...state.documentIndex.roots.slice(region.rootIndex + 1),
  ];
  void buildEditorRoots(splicedRoots, state.documentIndex.roots);
  const t5b = performance.now();

  // --- 6. createDocumentIndex(nextDocument) — full reindex baseline ---
  const t6a = performance.now();
  const fullIdx = createDocumentIndex(nextDocument);
  const t6b = performance.now();
  void fullIdx;

  // --- 7. fullPrelude: N × createEditorRoot + buildEditorRoots, no maps.
  // The delta (#6 − #7) ≈ time spent in createResolvedDocumentIndex on the cold path.
  const t7a = performance.now();
  const allRoots = nextDocument.blocks.map((block, rootIndex) =>
    createEditorRoot(block, rootIndex),
  );
  void buildEditorRoots(allRoots);
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
