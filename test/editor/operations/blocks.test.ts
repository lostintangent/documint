import { expect, test } from "bun:test";
import {
  dedent,
  handleStructuralBackspace,
  indent,
  insertLineBreak,
} from "@/editor/model/commands";
import {
  createDocumentFromEditorState,
  createEditorState,
  setCanvasSelection as setSelection,
} from "@/editor/model/state";
import { parseMarkdown, serializeMarkdown } from "@/markdown";

test("handles structural backspace for task markers, headings, and blockquotes", () => {
  let taskState = createEditorState(parseMarkdown("- [ ] alpha\n"));
  const alpha = taskState.documentEditor.regions.find((container) => container.text === "alpha");

  if (!alpha) {
    throw new Error("Expected alpha container");
  }

  taskState = setSelection(taskState, {
    regionId: alpha.id,
    offset: 0,
  });
  taskState = handleStructuralBackspace(taskState) ?? taskState;

  expect(serializeMarkdown(createDocumentFromEditorState(taskState))).toBe(
    "- alpha\n",
  );

  const plainAlpha = taskState.documentEditor.regions.find((container) => container.text === "alpha");

  if (!plainAlpha) {
    throw new Error("Expected plain alpha container");
  }

  taskState = setSelection(taskState, {
    regionId: plainAlpha.id,
    offset: 0,
  });
  taskState = handleStructuralBackspace(taskState) ?? taskState;

  expect(serializeMarkdown(createDocumentFromEditorState(taskState))).toBe(
    "alpha\n",
  );

  let headingState = createEditorState(parseMarkdown("# Heading\n"));
  const heading = headingState.documentEditor.regions.find((container) => container.text === "Heading");

  if (!heading) {
    throw new Error("Expected heading container");
  }

  headingState = setSelection(headingState, {
    regionId: heading.id,
    offset: 0,
  });
  headingState = handleStructuralBackspace(headingState) ?? headingState;

  expect(serializeMarkdown(createDocumentFromEditorState(headingState))).toBe(
    "Heading\n",
  );

  let quoteState = createEditorState(parseMarkdown("> quoted line\n"));
  const quoted = quoteState.documentEditor.regions.find((container) => container.text === "quoted line");

  if (!quoted) {
    throw new Error("Expected quoted line container");
  }

  quoteState = setSelection(quoteState, {
    regionId: quoted.id,
    offset: 0,
  });
  quoteState = handleStructuralBackspace(quoteState) ?? quoteState;

  expect(serializeMarkdown(createDocumentFromEditorState(quoteState))).toBe(
    "quoted line\n",
  );
});

test("merges or removes blocks when backspacing at the start", () => {
  let paragraphState = createEditorState(parseMarkdown("First\n\nSecond\n"));
  const second = paragraphState.documentEditor.regions.find((container) => container.text === "Second");

  if (!second) {
    throw new Error("Expected second paragraph");
  }

  paragraphState = setSelection(paragraphState, {
    regionId: second.id,
    offset: 0,
  });
  paragraphState = handleStructuralBackspace(paragraphState) ?? paragraphState;

  expect(serializeMarkdown(createDocumentFromEditorState(paragraphState))).toBe(
    "FirstSecond\n",
  );

  let blankParagraphState = createEditorState(parseMarkdown("First\n"));
  const first = blankParagraphState.documentEditor.regions.find((container) => container.text === "First");

  if (!first) {
    throw new Error("Expected first paragraph");
  }

  blankParagraphState = setSelection(blankParagraphState, {
    regionId: first.id,
    offset: first.text.length,
  });
  blankParagraphState = insertLineBreak(blankParagraphState)?.state ?? blankParagraphState;

  const blankParagraph = blankParagraphState.documentEditor.regions.find((container) => container.text === "");

  if (!blankParagraph) {
    throw new Error("Expected blank paragraph");
  }

  blankParagraphState = setSelection(blankParagraphState, {
    regionId: blankParagraph.id,
    offset: 0,
  });
  blankParagraphState = handleStructuralBackspace(blankParagraphState) ?? blankParagraphState;

  expect(serializeMarkdown(createDocumentFromEditorState(blankParagraphState))).toBe(
    "First\n",
  );
});

test("splits paragraphs and extends headings through enter", () => {
  let paragraphState = createEditorState(parseMarkdown("Paragraph body.\n"));
  const paragraph = paragraphState.documentEditor.regions[0];

  if (!paragraph) {
    throw new Error("Expected paragraph container");
  }

  paragraphState = setSelection(paragraphState, {
    regionId: paragraph.id,
    offset: "Paragraph".length,
  });
  paragraphState = insertLineBreak(paragraphState)?.state ?? paragraphState;

  expect(serializeMarkdown(createDocumentFromEditorState(paragraphState))).toBe(
    "Paragraph\n\n&#x20;body.\n",
  );

  let headingState = createEditorState(parseMarkdown("# Heading\n"));
  const heading = headingState.documentEditor.regions[0];

  if (!heading) {
    throw new Error("Expected heading container");
  }

  headingState = setSelection(headingState, {
    regionId: heading.id,
    offset: heading.text.length,
  });
  headingState = insertLineBreak(headingState)?.state ?? headingState;

  expect(serializeMarkdown(createDocumentFromEditorState(headingState))).toBe(
    "# Heading\n\n",
  );
});

test("moves the caret into the newly inserted empty paragraph when pressing enter on an empty paragraph", () => {
  let paragraphState = createEditorState(parseMarkdown("alpha\n"));
  const paragraph = paragraphState.documentEditor.regions[0];

  if (!paragraph) {
    throw new Error("Expected paragraph container");
  }

  paragraphState = setSelection(paragraphState, {
    regionId: paragraph.id,
    offset: paragraph.text.length,
  });
  paragraphState = insertLineBreak(paragraphState)?.state ?? paragraphState;

  const emptyParagraph = paragraphState.documentEditor.regions.find(
    (container) => container.blockType === "paragraph" && container.text === "",
  );

  if (!emptyParagraph) {
    throw new Error("Expected empty paragraph container");
  }

  paragraphState = setSelection(paragraphState, {
    regionId: emptyParagraph.id,
    offset: 0,
  });
  paragraphState = insertLineBreak(paragraphState)?.state ?? paragraphState;

  expect(serializeMarkdown(createDocumentFromEditorState(paragraphState))).toBe(
    "alpha\n\n\n\n",
  );

  const nextParagraphs = paragraphState.documentEditor.regions.filter(
    (container) => container.blockType === "paragraph",
  );
  const insertedParagraph = nextParagraphs[2];

  if (!insertedParagraph) {
    throw new Error("Expected inserted empty paragraph");
  }

  expect(paragraphState.selection.focus.regionId).toBe(insertedParagraph.id);
  expect(paragraphState.selection.focus.offset).toBe(0);
});

test("preserves blockquote and code-fence context on enter", () => {
  let quoteState = createEditorState(parseMarkdown("> quoted text\n"));
  const quoted = quoteState.documentEditor.regions.find((container) => container.text === "quoted text");

  if (!quoted) {
    throw new Error("Expected quoted container");
  }

  quoteState = setSelection(quoteState, {
    regionId: quoted.id,
    offset: "quoted".length,
  });
  quoteState = insertLineBreak(quoteState)?.state ?? quoteState;

  expect(serializeMarkdown(createDocumentFromEditorState(quoteState))).toBe(
    "> quoted\n>\n> &#x20;text\n",
  );

  let codeState = createEditorState(parseMarkdown("```ts\nconst x = 1;\n```\n"));
  const code = codeState.documentEditor.regions.find((container) => container.blockType === "code");

  if (!code) {
    throw new Error("Expected code container");
  }

  codeState = setSelection(codeState, {
    regionId: code.id,
    offset: code.text.length,
  });
  codeState = insertLineBreak(codeState)?.state ?? codeState;

  expect(serializeMarkdown(createDocumentFromEditorState(codeState))).toBe(
    "```ts\nconst x = 1;\n\n```\n",
  );
});

test("exits empty blockquote lines through the structural enter path", () => {
  let quoteState = createEditorState(parseMarkdown("> alpha\n"));
  const alpha = quoteState.documentEditor.regions.find((container) => container.text === "alpha");

  if (!alpha) {
    throw new Error("Expected quoted alpha container");
  }

  quoteState = setSelection(quoteState, {
    regionId: alpha.id,
    offset: alpha.text.length,
  });
  quoteState = insertLineBreak(quoteState)?.state ?? quoteState;

  const empty = quoteState.documentEditor.regions.find((container) => container.text === "");

  if (!empty) {
    throw new Error("Expected empty quoted container");
  }

  quoteState = setSelection(quoteState, {
    regionId: empty.id,
    offset: 0,
  });
  quoteState = insertLineBreak(quoteState)?.state ?? quoteState;

  expect(serializeMarkdown(createDocumentFromEditorState(quoteState))).toBe(
    "> alpha\n\n",
  );
});

test("re-enters the preceding blockquote when backspacing from the empty paragraph after exit", () => {
  let quoteState = createEditorState(parseMarkdown("> alpha\n"));
  const alpha = quoteState.documentEditor.regions.find((container) => container.text === "alpha");

  if (!alpha) {
    throw new Error("Expected quoted alpha container");
  }

  quoteState = setSelection(quoteState, {
    regionId: alpha.id,
    offset: alpha.text.length,
  });
  quoteState = insertLineBreak(quoteState)?.state ?? quoteState;
  quoteState = insertLineBreak(quoteState)?.state ?? quoteState;

  const emptyParagraph = quoteState.documentEditor.regions.find(
    (container) => container.blockType === "paragraph" && container.text === "",
  );

  if (!emptyParagraph) {
    throw new Error("Expected empty paragraph after blockquote exit");
  }

  quoteState = setSelection(quoteState, {
    regionId: emptyParagraph.id,
    offset: 0,
  });
  quoteState = handleStructuralBackspace(quoteState) ?? quoteState;

  expect(serializeMarkdown(createDocumentFromEditorState(quoteState))).toBe(
    "> alpha\n",
  );
  expect(quoteState.selection.focus.regionId).toBe(alpha.id);
  expect(quoteState.selection.focus.offset).toBe(alpha.text.length);
});

test("deletes empty quoted lines with structural backspace without unwrapping the whole quote", () => {
  let quoteState = createEditorState(parseMarkdown("> alpha\n"));
  const alpha = quoteState.documentEditor.regions.find((container) => container.text === "alpha");

  if (!alpha) {
    throw new Error("Expected quoted alpha container");
  }

  quoteState = setSelection(quoteState, {
    regionId: alpha.id,
    offset: alpha.text.length,
  });
  quoteState = insertLineBreak(quoteState)?.state ?? quoteState;

  const empty = quoteState.documentEditor.regions.find((container) => container.text === "");

  if (!empty) {
    throw new Error("Expected empty quoted container");
  }

  quoteState = setSelection(quoteState, {
    regionId: empty.id,
    offset: 0,
  });
  quoteState = handleStructuralBackspace(quoteState) ?? quoteState;

  expect(serializeMarkdown(createDocumentFromEditorState(quoteState))).toBe(
    "> alpha\n",
  );
  expect(quoteState.selection.focus.regionId).toBe(alpha.id);
  expect(quoteState.selection.focus.offset).toBe(alpha.text.length);
});

test("changes heading depth with tab and shift-tab", () => {
  let headingState = createEditorState(parseMarkdown("## Heading\n"));
  const heading = headingState.documentEditor.regions.find((container) => container.blockType === "heading");

  if (!heading) {
    throw new Error("Expected heading container");
  }

  headingState = setSelection(headingState, {
    regionId: heading.id,
    offset: 3,
  });
  headingState = indent(headingState) ?? headingState;

  expect(serializeMarkdown(createDocumentFromEditorState(headingState))).toBe(
    "### Heading\n",
  );
  expect(headingState.selection.focus.offset).toBe(3);

  headingState = dedent(headingState) ?? headingState;

  expect(serializeMarkdown(createDocumentFromEditorState(headingState))).toBe(
    "## Heading\n",
  );
  expect(headingState.selection.focus.offset).toBe(3);

  let h1State = createEditorState(parseMarkdown("# Heading\n"));
  const h1 = h1State.documentEditor.regions.find((container) => container.blockType === "heading");

  if (!h1) {
    throw new Error("Expected h1 container");
  }

  h1State = setSelection(h1State, {
    regionId: h1.id,
    offset: 2,
  });
  h1State = dedent(h1State) ?? h1State;

  expect(serializeMarkdown(createDocumentFromEditorState(h1State))).toBe(
    "# Heading\n",
  );

  let h6State = createEditorState(parseMarkdown("###### Heading\n"));
  const h6 = h6State.documentEditor.regions.find((container) => container.blockType === "heading");

  if (!h6) {
    throw new Error("Expected h6 container");
  }

  h6State = setSelection(h6State, {
    regionId: h6.id,
    offset: 2,
  });
  h6State = indent(h6State) ?? h6State;

  expect(serializeMarkdown(createDocumentFromEditorState(h6State))).toBe(
    "###### Heading\n",
  );
});
