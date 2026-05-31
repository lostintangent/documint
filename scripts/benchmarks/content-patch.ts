import { resolveDocumintPatch } from "@/sync/content-patch";
import { createEditorStateTransition } from "@/component/store/editor/transitions";
import {
  addComment,
  createEditorState,
  deleteBackward,
  insertLineBreak,
  insertText,
  setSelection,
  type EditorState,
} from "@/editor/state";
import { parseDocument } from "@/markdown";
import { runBudgetedBenchmark, type BenchmarkBudgetTree, type BenchmarkRecord } from "./shared";

type PatchFixture = {
  name: string;
  transition: ReturnType<typeof createEditorStateTransition>;
};

export function createContentPatchBenchmarks(
  budgets: BenchmarkBudgetTree["sync"],
): BenchmarkRecord[] {
  return [
    createPatchBenchmark(
      budgets,
      createParagraphFixture("content_patch_paragraph_edit", 10000, 5000),
      500,
    ),
    createPatchBenchmark(
      budgets,
      createParagraphSplitFixture("content_patch_paragraph_split", 10000, 5000),
      500,
    ),
    createPatchBenchmark(
      budgets,
      createListSplitFixture("content_patch_list_item_split", 10000, 5000),
      300,
    ),
    createPatchBenchmark(
      budgets,
      createListMergeFixture("content_patch_list_item_merge", 10000, 5000),
      300,
    ),
    createPatchBenchmark(budgets, createTableFixture("content_patch_table_cell", 2000), 200),
    createPatchBenchmark(budgets, createCodeMiddleFixture("content_patch_code_middle", 10000), 200),
    createPatchBenchmark(
      budgets,
      createCommentAppendixFixture("content_patch_comment_appendix", 10000, 5000),
      300,
    ),
  ];
}

function createPatchBenchmark(
  budgets: BenchmarkBudgetTree["sync"],
  fixture: PatchFixture,
  iterations: number,
): BenchmarkRecord {
  return runBudgetedBenchmark(budgets, fixture.name, iterations, () => {
    void resolveDocumintPatch(fixture.transition, "benchmark-revision");
  });
}

function createParagraphFixture(name: string, rootCount: number, editRootIndex: number) {
  const markdown = Array.from(
    { length: rootCount },
    (_, index) =>
      `Paragraph ${String(index + 1).padStart(5, "0")} carries unique patch benchmark text.`,
  ).join("\n\n");
  const previousState = createEditorState(parseDocument(`${markdown}\n`));
  const region = previousState.documentIndex.regions[editRootIndex];

  if (!region) {
    throw new Error(`Missing paragraph region at index ${editRootIndex}`);
  }

  return createFixture(name, previousState, region.id, region.text.length, " edited");
}

function createParagraphSplitFixture(name: string, rootCount: number, editRootIndex: number) {
  const previousState = createParagraphState(rootCount);
  const region = previousState.documentIndex.regions[editRootIndex];

  if (!region) {
    throw new Error(`Missing paragraph region at index ${editRootIndex}`);
  }

  const selectedState = setSelection(previousState, {
    offset: Math.floor(region.text.length / 2),
    regionId: region.id,
  });
  const nextState = insertLineBreak(selectedState);

  if (!nextState) {
    throw new Error(`Failed to split paragraph at index ${editRootIndex}`);
  }

  return createTransitionFixture(name, selectedState, nextState);
}

function createListSplitFixture(name: string, itemCount: number, editItemIndex: number) {
  const previousState = createListState(itemCount);
  const region = previousState.documentIndex.regions[editItemIndex];

  if (!region) {
    throw new Error(`Missing list item region at index ${editItemIndex}`);
  }

  const selectedState = setSelection(previousState, {
    offset: Math.floor(region.text.length / 2),
    regionId: region.id,
  });
  const nextState = insertLineBreak(selectedState);

  if (!nextState) {
    throw new Error(`Failed to split list item at index ${editItemIndex}`);
  }

  return createTransitionFixture(name, selectedState, nextState);
}

function createListMergeFixture(name: string, itemCount: number, editItemIndex: number) {
  const previousState = createListState(itemCount);
  const region = previousState.documentIndex.regions[editItemIndex];

  if (!region) {
    throw new Error(`Missing list item region at index ${editItemIndex}`);
  }

  const selectedState = setSelection(previousState, { offset: 0, regionId: region.id });
  const nextState = deleteBackward(selectedState);

  if (!nextState) {
    throw new Error(`Failed to merge list item at index ${editItemIndex}`);
  }

  return createTransitionFixture(name, selectedState, nextState);
}

function createCommentAppendixFixture(name: string, rootCount: number, editRootIndex: number) {
  const previousState = createParagraphState(rootCount);
  const region = previousState.documentIndex.regions[editRootIndex];

  if (!region) {
    throw new Error(`Missing paragraph region at index ${editRootIndex}`);
  }

  const selectedState = setSelection(previousState, {
    anchor: { offset: 0, regionId: region.id },
    focus: { offset: Math.min(12, region.text.length), regionId: region.id },
  });
  const nextState = addComment(
    selectedState,
    {
      endOffset: Math.min(12, region.text.length),
      regionId: region.id,
      startOffset: 0,
    },
    "Benchmark comment",
  );

  if (!nextState) {
    throw new Error(`Failed to add comment at paragraph index ${editRootIndex}`);
  }

  return createTransitionFixture(name, selectedState, nextState);
}

function createTableFixture(name: string, rowCount: number) {
  const rows = Array.from(
    { length: rowCount },
    (_, index) => `| cell ${index + 1} a | cell ${index + 1} b |`,
  );
  const markdown = ["| A | B |", "| - | - |", ...rows].join("\n") + "\n";
  const previousState = createEditorState(parseDocument(markdown));
  const targetText = `cell ${rowCount} b`;
  const region = previousState.documentIndex.regions.find(
    (candidate) => candidate.text === targetText,
  );

  if (!region) {
    throw new Error(`Missing table region: ${targetText}`);
  }

  return createFixture(name, previousState, region.id, region.text.length, " edited");
}

function createCodeMiddleFixture(name: string, lineCount: number) {
  const lines = Array.from(
    { length: lineCount },
    (_, index) => `const value${String(index + 1).padStart(5, "0")} = ${index + 1};`,
  );
  const middleLineIndex = Math.floor(lineCount / 2);
  const source = lines.join("\n");
  const previousState = createEditorState(parseDocument(`\`\`\`ts\n${source}\n\`\`\`\n`));
  const region = previousState.documentIndex.regions.find(
    (candidate) => candidate.block.type === "code",
  );

  if (!region) {
    throw new Error("Missing code region.");
  }

  const offset = lines.slice(0, middleLineIndex).join("\n").length + (middleLineIndex > 0 ? 1 : 0);

  return createFixture(name, previousState, region.id, offset, "const inserted = true;\n");
}

function createFixture(
  name: string,
  previousState: EditorState,
  regionId: string,
  offset: number,
  text: string,
): PatchFixture {
  const selectedState = setSelection(previousState, { offset, regionId });
  const nextState = insertText(selectedState, text);

  if (!nextState) {
    throw new Error(`Failed to create benchmark edit: ${name}`);
  }

  return {
    name,
    transition: createEditorStateTransition(selectedState, nextState, "local"),
  };
}

function createTransitionFixture(
  name: string,
  previousState: EditorState,
  nextState: EditorState,
): PatchFixture {
  return {
    name,
    transition: createEditorStateTransition(previousState, nextState, "local"),
  };
}

function createParagraphState(rootCount: number) {
  const markdown = Array.from(
    { length: rootCount },
    (_, index) =>
      `Paragraph ${String(index + 1).padStart(5, "0")} carries unique patch benchmark text.`,
  ).join("\n\n");

  return createEditorState(parseDocument(`${markdown}\n`));
}

function createListState(itemCount: number) {
  const markdown = Array.from(
    { length: itemCount },
    (_, index) => `- Item ${String(index + 1).padStart(5, "0")} carries unique benchmark text.`,
  ).join("\n");

  return createEditorState(parseDocument(`${markdown}\n`));
}
