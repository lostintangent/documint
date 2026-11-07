import { indexedTextEntries } from "@test/editor/helpers";
import { cursorLeafSprig } from "@/component/overlays/leaves/sprigs";
import { createStore } from "@/component/store";
import { reconcileExternalContentChange } from "@/component/sync";
import {
  acknowledgeUnacknowledgedDocumentChanges,
  mergeUnacknowledgedDocumentChanges,
} from "@/component/sync/live-changes";
import { compileDecorations } from "@/component/decorations/worker/matching";
import { resolveCompiledBlockDecorationRanges } from "@/component/decorations/worker/prose";
import { builtinGrammars, resolveCodeGrammars } from "@/component/decorations/grammars";
import {
  compileCodeGrammars,
  resolveCodeDecorationRanges,
} from "@/component/decorations/worker/code";
import {
  createParagraphTextBlock,
  createDocumentNodeAnchor,
  findDocumentChanges,
  resolveDocumentNodeAnchors,
  rootBlockPath,
  spliceDocument,
} from "@/document";
import { createEditorLayoutState, createLayoutCache } from "@/editor";
import { createEditorState, resolveBlockTextPathBoundary, setSelection } from "@/editor/state";
import { parseDocument } from "@/markdown";
import type { BenchmarkFixtures } from "../fixtures";
import { BENCHMARK_VIEWPORT, createBenchmarkScenario, type BenchmarkScenario } from "../harness";
import { createDenseCommentSnapshot } from "./editor";

const decorationRules = [
  { color: "#d00", pattern: /\b(?:document|list|table|text|item)\b/gi },
  { color: "#06c", pattern: /\b(?:heading|code|link)\b/gi },
] as const;
const compiledDecorationRules = compileDecorations(decorationRules);

// Code grammars compiled the way the worker compiles them (scope colors are
// irrelevant to tokenization cost, so any color resolves them).
const compiledGrammars = compileCodeGrammars(resolveCodeGrammars(builtinGrammars, () => "#fff"));

export function createComponentScenarios(fixtures: BenchmarkFixtures): BenchmarkScenario[] {
  const fixture = createLongReconciliationFixture(1200);
  const codeHeavySnapshot = parseDocument(createCodeHeavyMarkdown(200));
  const externalChangesFixture = createExternalChangesFixture();
  const cursorLeafFixture = createCursorLeafFixture(fixtures.mediumMarkdown);

  return [
    createBenchmarkScenario("component_decorations_medium", 100, () =>
      fixtures.mediumSnapshot.blocks.forEach((block, rootIndex) =>
        resolveCompiledBlockDecorationRanges(block, rootIndex, compiledDecorationRules),
      ),
    ),
    createBenchmarkScenario("component_decorations_long", 50, () =>
      fixtures.longSnapshot.blocks.forEach((block, rootIndex) =>
        resolveCompiledBlockDecorationRanges(block, rootIndex, compiledDecorationRules),
      ),
    ),
    createBenchmarkScenario("component_grammar_tokenize_code_heavy", 150, () =>
      codeHeavySnapshot.blocks.forEach((block, rootIndex) =>
        resolveCodeDecorationRanges(block, rootIndex, compiledGrammars),
      ),
    ),
    // Caret moves keep `documentIndex`, so cursor leaves must reuse the
    // store's cached comment ranges instead of re-resolving every thread.
    createBenchmarkScenario("component_cursor_leaf_comments_dense", 200, () => {
      const { points, store } = cursorLeafFixture;

      for (const point of points) {
        store.editor.command(setSelection, point);
        void cursorLeafSprig.read(store, false);
      }
    }),
    createBenchmarkScenario("component_reconcile_selection_long", 200, () => {
      void reconcileExternalContentChange(fixture.selectedState, fixture.shiftedState);
    }),
    createBenchmarkScenario("component_reconcile_transient_empty_paragraph_long", 100, () => {
      void reconcileExternalContentChange(fixture.transientState, fixture.shiftedState);
    }),
    createBenchmarkScenario("component_diff_external_blocks", 100, () => {
      void findDocumentChanges(
        externalChangesFixture.previousBlocks,
        externalChangesFixture.nextBlocks,
      );
    }),
    createBenchmarkScenario("component_diff_external_table", 100, () => {
      void findDocumentChanges(
        externalChangesFixture.previousTable,
        externalChangesFixture.nextTable,
      );
    }),
    createBenchmarkScenario("component_merge_external_changes", 200, () => {
      void mergeUnacknowledgedDocumentChanges(
        [],
        externalChangesFixture.incomingChanges,
        externalChangesFixture.incomingState,
      );
    }),
    createBenchmarkScenario("component_acknowledge_external_changes_local_edit", 200, () => {
      void acknowledgeUnacknowledgedDocumentChanges(
        externalChangesFixture.unacknowledgedChanges,
        externalChangesFixture.localEditState,
        { retarget: true },
      );
    }),
    createBenchmarkScenario("component_retarget_many_external_changes_reparsed_shift", 100, () => {
      void acknowledgeUnacknowledgedDocumentChanges(
        externalChangesFixture.manyUnacknowledgedChanges,
        externalChangesFixture.manyReparsedShiftState,
        { retarget: true },
      );
    }),
    createBenchmarkScenario("component_resolve_duplicate_node_anchors", 100, () => {
      void resolveDocumentNodeAnchors(
        externalChangesFixture.duplicateAnchorNext,
        externalChangesFixture.duplicateAnchors,
      );
    }),
  ];
}

// Dense threads on the first bullet of a long document with unique text, so
// every thread resolves. The caret walks 25 text paths from that bullet.
function createCursorLeafFixture(seedMarkdown: string) {
  const snapshot = parseDocument(`${seedMarkdown}\n\n${createNumberedParagraphMarkdown(1200)}`);
  const store = createStore(createDenseCommentSnapshot(snapshot, 60));
  const entries = indexedTextEntries(store.editor.getState());
  const start = entries.findIndex((entry) => entry.text.includes("Bullet item"));
  const points = entries
    .slice(start, start + 25)
    .map((entry) => ({ offset: Math.min(2, entry.text.length), path: entry.path }));

  store.layout.setLayoutResolver(() =>
    createEditorLayoutState(
      store.editor.getState(),
      { ...BENCHMARK_VIEWPORT, top: 0 },
      createLayoutCache(),
    ),
  );
  store.layout.commit();

  return { points, store };
}

function createExternalChangesFixture() {
  const previousBlocksMarkdown = createNumberedParagraphMarkdown(180);
  const nextBlocksMarkdown = [
    "External intro paragraph.",
    "",
    ...Array.from({ length: 180 }, (_, index) =>
      index === 90
        ? "Paragraph 0091 carries unique reconciliation text with an external update."
        : `Paragraph ${String(index + 1).padStart(4, "0")} carries unique reconciliation text.`,
    ).flatMap((paragraph) => [paragraph, ""]),
  ].join("\n");
  const previousBlocks = parseDocument(previousBlocksMarkdown);
  const nextBlocks = parseDocument(nextBlocksMarkdown);
  const incomingState = selectLastPath(createEditorState(nextBlocks));
  const incomingChanges = findDocumentChanges(previousBlocks, nextBlocks);
  const merge = mergeUnacknowledgedDocumentChanges([], incomingChanges, incomingState);
  const nextManyBlocksMarkdown = createManyExternalBlockChangesMarkdown(180);
  const nextManyBlocks = parseDocument(nextManyBlocksMarkdown);
  const manyIncomingState = selectLastPath(createEditorState(nextManyBlocks));
  const manyIncomingChanges = findDocumentChanges(previousBlocks, nextManyBlocks);
  const manyMerge = mergeUnacknowledgedDocumentChanges([], manyIncomingChanges, manyIncomingState);
  const manyReparsedShiftState = selectFirstPath(
    createEditorState(
      parseDocument(
        [
          "Externally inserted paragraph before many unacknowledged changes.",
          "",
          nextManyBlocksMarkdown,
        ].join("\n"),
      ),
    ),
  );
  const localEditDocument = spliceDocument(nextBlocks, 0, 0, [
    createParagraphTextBlock("Local paragraph before unacknowledged external changes."),
  ]);
  const localEditState = selectFirstPath(createEditorState(localEditDocument));
  const previousTable = parseDocument(createBenchmarkTable(48, "old"));
  const nextTable = parseDocument(createBenchmarkTable(48, "new"));
  const duplicateAnchorFixture = createDuplicateAnchorFixture(48);

  return {
    duplicateAnchorNext: duplicateAnchorFixture.next,
    duplicateAnchors: duplicateAnchorFixture.anchors,
    incomingChanges,
    incomingState,
    localEditState,
    manyReparsedShiftState,
    manyUnacknowledgedChanges: manyMerge.changes,
    nextBlocks,
    nextTable,
    previousBlocks,
    previousTable,
    unacknowledgedChanges: merge.changes,
  };
}

function createDuplicateAnchorFixture(count: number) {
  const previous = parseDocument(
    Array.from({ length: count }, (_, index) =>
      [`Before ${index}`, "Repeated target", `After ${index}`].join("\n\n"),
    ).join("\n\n"),
  );
  const next = parseDocument(
    Array.from({ length: count }, (_, index) =>
      ["Repeated target", `Before ${index}`, "Repeated target", `After ${index}`].join("\n\n"),
    ).join("\n\n"),
  );
  const anchors = Array.from({ length: count }, (_, index) => {
    const anchor = createDocumentNodeAnchor(previous, `root.${index * 3 + 1}`);
    if (!anchor) {
      throw new Error(`Missing duplicate node anchor ${index}`);
    }
    return anchor;
  });

  return { anchors, next };
}

function createLongReconciliationFixture(pathCount: number) {
  const markdown = createNumberedParagraphMarkdown(pathCount);
  const shiftedMarkdown = `External intro paragraph.\n\n${markdown}`;
  const baseState = createEditorState(parseDocument(markdown));
  const shiftedState = createEditorState(parseDocument(shiftedMarkdown));
  const selectedState = selectPath(baseState, Math.floor(pathCount / 2));
  const transientState = insertTransientEmptyRootParagraph(baseState, pathCount);

  return {
    selectedState,
    shiftedState,
    transientState,
  };
}

function createNumberedParagraphMarkdown(count: number) {
  return Array.from(
    { length: count },
    (_, index) =>
      `Paragraph ${String(index + 1).padStart(4, "0")} carries unique reconciliation text.`,
  ).join("\n\n");
}

function createManyExternalBlockChangesMarkdown(count: number) {
  return Array.from({ length: count }, (_, index) => {
    const paragraphNumber = String(index + 1).padStart(4, "0");
    const changedSuffix =
      index >= 72 && index < 88 ? ` with distinct external update ${index}` : "";
    return `Paragraph ${paragraphNumber} carries unique reconciliation text${changedSuffix}.`;
  }).join("\n\n");
}

function createCodeHeavyMarkdown(blockCount: number) {
  const snippet = [
    "```ts",
    "export async function handler(request: Request): Promise<Response> {",
    "  const url = new URL(request.url); // route the request",
    '  if (url.pathname === "/health") return new Response("ok", { status: 200 });',
    '  const data = JSON.parse((await request.text()) || "{}");',
    "  return new Response(JSON.stringify({ data, count: 42, ok: true }));",
    "}",
    "```",
  ].join("\n");

  return Array.from({ length: blockCount }, () => snippet).join("\n\n");
}

function createBenchmarkTable(rowCount: number, changedPrefix: "new" | "old") {
  const rows = Array.from({ length: rowCount }, (_, index) => {
    const value =
      index === Math.floor(rowCount / 2) ? `${changedPrefix} value ${index}` : `value ${index}`;
    return `| row ${index} | ${value} |`;
  });

  return ["| A | B |", "| - | - |", ...rows].join("\n") + "\n";
}

function selectPath(state: ReturnType<typeof createEditorState>, pathIndex: number) {
  const path = indexedTextEntries(state)[pathIndex];

  if (!path) {
    throw new Error(`Missing editor path at index ${pathIndex}`);
  }

  return setSelection(state, {
    offset: Math.floor(path.text.length / 2),
    path: path.path,
  });
}

function selectFirstPath(state: ReturnType<typeof createEditorState>) {
  return selectPath(state, 0);
}

function selectLastPath(state: ReturnType<typeof createEditorState>) {
  return selectPath(state, indexedTextEntries(state).length - 1);
}

function insertTransientEmptyRootParagraph(
  state: ReturnType<typeof createEditorState>,
  rootIndex: number,
) {
  const nextDocument = spliceDocument(state.documentIndex.document, rootIndex, 0, [
    createParagraphTextBlock(""),
  ]);
  const nextState = createEditorState(nextDocument);
  const point = resolveBlockTextPathBoundary(
    nextState.documentIndex,
    rootBlockPath(rootIndex),
    "start",
  );
  const selection = point
    ? {
        anchor: { path: point, offset: 0 },
        focus: { path: point, offset: 0 },
      }
    : null;

  if (!selection) {
    throw new Error(`Missing inserted empty paragraph at root index ${rootIndex}`);
  }

  return setSelection(nextState, selection);
}
