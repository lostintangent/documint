import { reconcileExternalContentChange } from "@/component/sync";
import {
  acknowledgeUnacknowledgedDocumentChanges,
  mergeUnacknowledgedDocumentChanges,
} from "@/component/sync/external-changes";
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
  spliceDocument,
  type Document,
} from "@/document";
import { createEditorState, resolveRootPrimaryRegion, setSelection } from "@/editor/state";
import { parseDocument } from "@/markdown";
import type { BenchmarkScenario } from "../harness";
import { createBenchmarkScenario } from "../harness";

const decorationRules = [
  { color: "#d00", pattern: /\b(?:document|list|table|text|item)\b/gi },
  { color: "#06c", pattern: /\b(?:heading|code|link)\b/gi },
] as const;
const compiledDecorationRules = compileDecorations(decorationRules);

// Code grammars compiled the way the worker compiles them (scope colors are
// irrelevant to tokenization cost, so any color resolves them).
const compiledGrammars = compileCodeGrammars(resolveCodeGrammars(builtinGrammars, () => "#fff"));

export function createComponentScenarios(fixtures: {
  longSnapshot: Document;
  mediumSnapshot: Document;
}): BenchmarkScenario[] {
  const fixture = createLongReconciliationFixture(1200);
  const codeHeavySnapshot = parseDocument(createCodeHeavyMarkdown(200));
  const externalChangesFixture = createExternalChangesFixture();

  return [
    createBenchmarkScenario(
      "component",
      "component_decorations_medium",
      100,
      () =>
        void fixtures.mediumSnapshot.blocks.forEach((block, rootIndex) =>
          resolveCompiledBlockDecorationRanges(block, rootIndex, compiledDecorationRules),
        ),
    ),
    createBenchmarkScenario(
      "component",
      "component_decorations_long",
      50,
      () =>
        void fixtures.longSnapshot.blocks.forEach((block, rootIndex) =>
          resolveCompiledBlockDecorationRanges(block, rootIndex, compiledDecorationRules),
        ),
    ),
    createBenchmarkScenario(
      "component",
      "component_grammar_tokenize_code_heavy",
      50,
      () =>
        void codeHeavySnapshot.blocks.forEach((block, rootIndex) =>
          resolveCodeDecorationRanges(block, rootIndex, compiledGrammars),
        ),
    ),
    createBenchmarkScenario("component", "component_reconcile_selection_long", 200, () => {
      void reconcileExternalContentChange(fixture.selectedState, fixture.shiftedState);
    }),
    createBenchmarkScenario("component", "component_reconcile_transient_empty_paragraph_long", 100, () => {
      void reconcileExternalContentChange(fixture.transientState, fixture.shiftedState);
    }),
    createBenchmarkScenario("component", "component_diff_external_blocks", 100, () => {
      void findDocumentChanges(
        externalChangesFixture.previousBlocks,
        externalChangesFixture.nextBlocks,
      );
    }),
    createBenchmarkScenario("component", "component_diff_external_table", 100, () => {
      void findDocumentChanges(
        externalChangesFixture.previousTable,
        externalChangesFixture.nextTable,
      );
    }),
    createBenchmarkScenario("component", "component_merge_external_changes", 200, () => {
      void mergeUnacknowledgedDocumentChanges(
        [],
        externalChangesFixture.incomingChanges,
        externalChangesFixture.incomingState,
      );
    }),
    createBenchmarkScenario("component", "component_acknowledge_external_changes_local_edit", 200, () => {
      void acknowledgeUnacknowledgedDocumentChanges(
        externalChangesFixture.unacknowledgedChanges,
        externalChangesFixture.localEditState,
        { retarget: true },
      );
    }),
    createBenchmarkScenario(
      "component",
      "component_retarget_many_external_changes_reparsed_shift",
      100,
      () => {
        void acknowledgeUnacknowledgedDocumentChanges(
          externalChangesFixture.manyUnacknowledgedChanges,
          externalChangesFixture.manyReparsedShiftState,
          { retarget: true },
        );
      },
    ),
    createBenchmarkScenario("component", "component_resolve_duplicate_node_anchors", 100, () => {
      void resolveDocumentNodeAnchors(
        externalChangesFixture.duplicateAnchorNext,
        externalChangesFixture.duplicateAnchors,
      );
    }),
  ];
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
  const incomingState = selectLastRegion(createEditorState(nextBlocks));
  const incomingChanges = findDocumentChanges(previousBlocks, nextBlocks);
  const merge = mergeUnacknowledgedDocumentChanges([], incomingChanges, incomingState);
  const nextManyBlocksMarkdown = createManyExternalBlockChangesMarkdown(180);
  const nextManyBlocks = parseDocument(nextManyBlocksMarkdown);
  const manyIncomingState = selectLastRegion(createEditorState(nextManyBlocks));
  const manyIncomingChanges = findDocumentChanges(previousBlocks, nextManyBlocks);
  const manyMerge = mergeUnacknowledgedDocumentChanges([], manyIncomingChanges, manyIncomingState);
  const manyReparsedShiftState = selectFirstRegion(
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
  const localEditState = selectFirstRegion(createEditorState(localEditDocument));
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

function createLongReconciliationFixture(regionCount: number) {
  const markdown = createNumberedParagraphMarkdown(regionCount);
  const shiftedMarkdown = `External intro paragraph.\n\n${markdown}`;
  const baseState = createEditorState(parseDocument(markdown));
  const shiftedState = createEditorState(parseDocument(shiftedMarkdown));
  const selectedState = selectRegion(baseState, Math.floor(regionCount / 2));
  const transientState = insertTransientEmptyRootParagraph(baseState, regionCount);

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

function selectRegion(state: ReturnType<typeof createEditorState>, regionIndex: number) {
  const region = state.documentIndex.regions[regionIndex];

  if (!region) {
    throw new Error(`Missing editor region at index ${regionIndex}`);
  }

  return setSelection(state, {
    offset: Math.floor(region.text.length / 2),
    regionId: region.id,
  });
}

function selectFirstRegion(state: ReturnType<typeof createEditorState>) {
  return selectRegion(state, 0);
}

function selectLastRegion(state: ReturnType<typeof createEditorState>) {
  return selectRegion(state, state.documentIndex.regions.length - 1);
}

function insertTransientEmptyRootParagraph(
  state: ReturnType<typeof createEditorState>,
  rootIndex: number,
) {
  const nextDocument = spliceDocument(state.documentIndex.document, rootIndex, 0, [
    createParagraphTextBlock(""),
  ]);
  const nextState = createEditorState(nextDocument);
  const region = resolveRootPrimaryRegion(nextState.documentIndex, rootIndex);
  const selection = region
    ? {
        anchor: { regionId: region.id, offset: 0 },
        focus: { regionId: region.id, offset: 0 },
      }
    : null;

  if (!selection) {
    throw new Error(`Missing inserted empty paragraph at root index ${rootIndex}`);
  }

  return setSelection(nextState, selection);
}
