import { reconcileExternalContentChange } from "@/component/sync";
import { resolveBlockDecorationRanges } from "@/component/decorations/ranges";
import { createParagraphTextBlock, spliceDocument, type Document } from "@/document";
import {
  createEditorState,
  resolveRootPrimaryRegion,
  setSelection,
} from "@/editor/state";
import { parseDocument } from "@/markdown";
import type { BenchmarkBudgetTree, BenchmarkRecord } from "./shared";
import { runBudgetedBenchmark } from "./shared";

const decorationRules = [
  { color: "#d00", pattern: /\b(?:document|list|table|text|item)\b/gi },
  { color: "#06c", pattern: /\b(?:heading|code|link)\b/gi },
] as const;

export function createComponentBenchmarks(
  budgets: BenchmarkBudgetTree["component"],
  fixtures: {
    longSnapshot: Document;
    mediumSnapshot: Document;
  },
): BenchmarkRecord[] {
  const fixture = createLongReconciliationFixture(1200);

  return [
    runBudgetedBenchmark(
      budgets,
      "component_decorations_medium",
      100,
      () =>
        void fixtures.mediumSnapshot.blocks.forEach((block, rootIndex) =>
          resolveBlockDecorationRanges(block, rootIndex, decorationRules),
        ),
    ),
    runBudgetedBenchmark(
      budgets,
      "component_decorations_long",
      50,
      () =>
        void fixtures.longSnapshot.blocks.forEach((block, rootIndex) =>
          resolveBlockDecorationRanges(block, rootIndex, decorationRules),
        ),
    ),
    runBudgetedBenchmark(budgets, "component_reconcile_selection_long", 200, () => {
      void reconcileExternalContentChange(fixture.selectedState, fixture.shiftedState);
    }),
    runBudgetedBenchmark(budgets, "component_reconcile_transient_empty_paragraph_long", 100, () => {
      void reconcileExternalContentChange(fixture.transientState, fixture.shiftedState);
    }),
  ];
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
