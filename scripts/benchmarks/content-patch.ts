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
import { parseDocument, serializeDocument } from "@/markdown";
import { runBenchmark, type BenchmarkRecord } from "./shared";

type PatchFixture = {
  name: string;
  nextState: EditorState;
  transition: ReturnType<typeof createEditorStateTransition>;
};

const paragraphEndFixture = createParagraphFixture("paragraph_end_10000_roots", 10000, 9999);
const paragraphMiddleFixture = createParagraphFixture("paragraph_middle_10000_roots", 10000, 5000);
const paragraphMultiRootFixture = createParagraphMultiRootFixture(
  "paragraph_multi_root_10000_roots",
  10000,
  [1000, 5000, 9000],
);
const paragraphSplitFixture = createParagraphSplitFixture(
  "paragraph_split_10000_roots",
  10000,
  5000,
);
const paragraphMergeFixture = createParagraphMergeFixture(
  "paragraph_merge_10000_roots",
  10000,
  5000,
);
const listSplitFixture = createListSplitFixture("list_item_split_10000_items", 10000, 5000);
const listMergeFixture = createListMergeFixture("list_item_merge_10000_items", 10000, 5000);
const tableFixture = createTableFixture("table_cell_2000_rows", 2000);
const codeAppendFixture = createCodeAppendFixture("code_block_append_10000_lines", 10000);
const codeMiddleFixture = createCodeMiddleFixture("code_block_middle_10000_lines", 10000);
const commentAppendixFixture = createCommentAppendixFixture(
  "comment_appendix_10000_roots",
  10000,
  5000,
);

const records = [
  ...createPatchBenchmarks(paragraphMiddleFixture, 500),
  ...createPatchBenchmarks(paragraphEndFixture, 500),
  ...createPatchBenchmarks(paragraphMultiRootFixture, 500),
  ...createPatchBenchmarks(paragraphSplitFixture, 500),
  ...createPatchBenchmarks(paragraphMergeFixture, 500),
  ...createPatchBenchmarks(listSplitFixture, 300),
  ...createPatchBenchmarks(listMergeFixture, 300),
  ...createPatchBenchmarks(tableFixture, 200),
  ...createPatchBenchmarks(codeAppendFixture, 200),
  ...createPatchBenchmarks(codeMiddleFixture, 200),
  ...createPatchBenchmarks(commentAppendixFixture, 300),
];

console.table(records);

function createPatchBenchmarks(fixture: PatchFixture, iterations: number): BenchmarkRecord[] {
  return [
    runBenchmark(`content_patch_${fixture.name}`, iterations, undefined, () => {
      void resolveDocumintPatch(fixture.transition, "benchmark-revision");
    }),
    runBenchmark(`content_serialize_${fixture.name}`, iterations, undefined, () => {
      void serializeDocument(fixture.nextState.documentIndex.document);
    }),
  ];
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

function createParagraphMultiRootFixture(
  name: string,
  rootCount: number,
  editRootIndexes: number[],
) {
  const markdown = Array.from(
    { length: rootCount },
    (_, index) =>
      `Paragraph ${String(index + 1).padStart(5, "0")} carries unique patch benchmark text.`,
  ).join("\n\n");
  const previousState = createEditorState(parseDocument(`${markdown}\n`));
  let nextState: EditorState = previousState;

  for (const rootIndex of editRootIndexes) {
    const region = nextState.documentIndex.regions[rootIndex];

    if (!region) {
      throw new Error(`Missing paragraph region at index ${rootIndex}`);
    }

    const editedState = insertText(
      setSelection(nextState, { offset: region.text.length, regionId: region.id }),
      " edited",
    );

    if (!editedState) {
      throw new Error(`Failed to edit paragraph region at index ${rootIndex}`);
    }

    nextState = editedState;
  }

  return {
    name,
    nextState,
    transition: createEditorStateTransition(previousState, nextState, "local"),
  };
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

function createParagraphMergeFixture(name: string, rootCount: number, editRootIndex: number) {
  const previousState = createParagraphState(rootCount);
  const region = previousState.documentIndex.regions[editRootIndex];

  if (!region) {
    throw new Error(`Missing paragraph region at index ${editRootIndex}`);
  }

  const selectedState = setSelection(previousState, { offset: 0, regionId: region.id });
  const nextState = deleteBackward(selectedState);

  if (!nextState) {
    throw new Error(`Failed to merge paragraph at index ${editRootIndex}`);
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

function createCodeAppendFixture(name: string, lineCount: number) {
  const source = Array.from(
    { length: lineCount },
    (_, index) => `const value${String(index + 1).padStart(5, "0")} = ${index + 1};`,
  ).join("\n");
  const previousState = createEditorState(parseDocument(`\`\`\`ts\n${source}\n\`\`\`\n`));
  const region = previousState.documentIndex.regions.find(
    (candidate) => candidate.block.type === "code",
  );

  if (!region) {
    throw new Error("Missing code region.");
  }

  return createFixture(
    name,
    previousState,
    region.id,
    region.text.length,
    "\nconst inserted = true;",
  );
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
    nextState,
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
    nextState,
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
