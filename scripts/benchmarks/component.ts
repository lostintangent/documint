import { reconcileExternalContentChange } from "@/component/lib/reconciliation";
import { createParagraphTextBlock, spliceDocument } from "@/document";
import {
  createEditorState,
  createRootPrimaryRegionTarget,
  resolveSelectionTarget,
  setSelection,
} from "@/editor/state";
import { parseDocument } from "@/markdown";
import type { BenchmarkBudgetTree, BenchmarkRecord } from "./shared";
import { runBenchmark } from "./shared";

export function createComponentBenchmarks(
  budgets: BenchmarkBudgetTree["component"],
): BenchmarkRecord[] {
  const fixture = createLongReconciliationFixture(1200);

  return [
    runBenchmark("component_reconcile_selection_long", 50, budgets.reconcile_selection_long, () => {
      void reconcileExternalContentChange(fixture.selectedState, fixture.shiftedState);
    }),
    runBenchmark(
      "component_reconcile_transient_empty_paragraph_long",
      20,
      budgets.reconcile_transient_empty_paragraph_long,
      () => {
        void reconcileExternalContentChange(fixture.transientState, fixture.shiftedState);
      },
    ),
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
    createParagraphTextBlock({ text: "" }),
  ]);
  const nextState = createEditorState(nextDocument);
  const selection = resolveSelectionTarget(
    nextState.documentIndex,
    createRootPrimaryRegionTarget(rootIndex),
  );

  if (!selection) {
    throw new Error(`Missing inserted empty paragraph at root index ${rootIndex}`);
  }

  return setSelection(nextState, selection);
}
