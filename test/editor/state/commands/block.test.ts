import { expect, test } from "bun:test";
import { dedent, deleteBackward, indent, insertLineBreak, insertText } from "@/editor/state";
import { createDocumentFromEditorState, createEditorState, setSelection } from "@/editor/state";
import { parseDocument, serializeDocument } from "@/markdown";

test("removes task markers, demotes headings, and unwraps single-line blockquotes on backspace", () => {
  let taskState = createEditorState(parseDocument("- [ ] alpha\n"));
  const alpha = taskState.documentIndex.regions.find((container) => container.text === "alpha");

  if (!alpha) {
    throw new Error("Expected alpha container");
  }

  taskState = setSelection(taskState, {
    regionId: alpha.id,
    offset: 0,
  });
  taskState = deleteBackward(taskState) ?? taskState;

  expect(serializeDocument(createDocumentFromEditorState(taskState))).toBe("- alpha\n");

  const plainAlpha = taskState.documentIndex.regions.find(
    (container) => container.text === "alpha",
  );

  if (!plainAlpha) {
    throw new Error("Expected plain alpha container");
  }

  taskState = setSelection(taskState, {
    regionId: plainAlpha.id,
    offset: 0,
  });
  taskState = deleteBackward(taskState) ?? taskState;

  expect(serializeDocument(createDocumentFromEditorState(taskState))).toBe("alpha\n");

  let headingState = createEditorState(parseDocument("# Heading\n"));
  const heading = headingState.documentIndex.regions.find(
    (container) => container.text === "Heading",
  );

  if (!heading) {
    throw new Error("Expected heading container");
  }

  headingState = setSelection(headingState, {
    regionId: heading.id,
    offset: 0,
  });
  headingState = deleteBackward(headingState) ?? headingState;

  expect(serializeDocument(createDocumentFromEditorState(headingState))).toBe("Heading\n");

  let quoteState = createEditorState(parseDocument("> quoted line\n"));
  const quoted = quoteState.documentIndex.regions.find(
    (container) => container.text === "quoted line",
  );

  if (!quoted) {
    throw new Error("Expected quoted line container");
  }

  quoteState = setSelection(quoteState, {
    regionId: quoted.id,
    offset: 0,
  });
  quoteState = deleteBackward(quoteState) ?? quoteState;

  expect(serializeDocument(createDocumentFromEditorState(quoteState))).toBe("quoted line\n");
});

test("merges or removes blocks when backspacing at the start", () => {
  let paragraphState = createEditorState(parseDocument("First\n\nSecond\n"));
  const second = paragraphState.documentIndex.regions.find(
    (container) => container.text === "Second",
  );

  if (!second) {
    throw new Error("Expected second paragraph");
  }

  paragraphState = setSelection(paragraphState, {
    regionId: second.id,
    offset: 0,
  });
  paragraphState = deleteBackward(paragraphState) ?? paragraphState;

  expect(serializeDocument(createDocumentFromEditorState(paragraphState))).toBe("FirstSecond\n");

  let blankParagraphState = createEditorState(parseDocument("First\n"));
  const first = blankParagraphState.documentIndex.regions.find(
    (container) => container.text === "First",
  );

  if (!first) {
    throw new Error("Expected first paragraph");
  }

  blankParagraphState = setSelection(blankParagraphState, {
    regionId: first.id,
    offset: first.text.length,
  });
  blankParagraphState = insertLineBreak(blankParagraphState) ?? blankParagraphState;

  const blankParagraph = blankParagraphState.documentIndex.regions.find(
    (container) => container.text === "",
  );

  if (!blankParagraph) {
    throw new Error("Expected blank paragraph");
  }

  blankParagraphState = setSelection(blankParagraphState, {
    regionId: blankParagraph.id,
    offset: 0,
  });
  blankParagraphState = deleteBackward(blankParagraphState) ?? blankParagraphState;

  expect(serializeDocument(createDocumentFromEditorState(blankParagraphState))).toBe("First\n");
});

test("splits paragraphs and extends headings through enter", () => {
  let paragraphState = createEditorState(parseDocument("Paragraph body.\n"));
  const paragraph = paragraphState.documentIndex.regions[0];

  if (!paragraph) {
    throw new Error("Expected paragraph container");
  }

  paragraphState = setSelection(paragraphState, {
    regionId: paragraph.id,
    offset: "Paragraph".length,
  });
  paragraphState = insertLineBreak(paragraphState) ?? paragraphState;

  expect(serializeDocument(createDocumentFromEditorState(paragraphState))).toBe(
    "Paragraph\n\n&#x20;body.\n",
  );

  let headingState = createEditorState(parseDocument("# Heading\n"));
  const heading = headingState.documentIndex.regions[0];

  if (!heading) {
    throw new Error("Expected heading container");
  }

  headingState = setSelection(headingState, {
    regionId: heading.id,
    offset: heading.text.length,
  });
  headingState = insertLineBreak(headingState) ?? headingState;

  expect(serializeDocument(createDocumentFromEditorState(headingState))).toBe("# Heading\n\n");
});

test("moves the caret into the newly inserted empty paragraph when pressing enter on an empty paragraph", () => {
  let paragraphState = createEditorState(parseDocument("alpha\n"));
  const paragraph = paragraphState.documentIndex.regions[0];

  if (!paragraph) {
    throw new Error("Expected paragraph container");
  }

  paragraphState = setSelection(paragraphState, {
    regionId: paragraph.id,
    offset: paragraph.text.length,
  });
  paragraphState = insertLineBreak(paragraphState) ?? paragraphState;

  const emptyParagraph = paragraphState.documentIndex.regions.find(
    (container) => container.blockType === "paragraph" && container.text === "",
  );

  if (!emptyParagraph) {
    throw new Error("Expected empty paragraph container");
  }

  paragraphState = setSelection(paragraphState, {
    regionId: emptyParagraph.id,
    offset: 0,
  });
  paragraphState = insertLineBreak(paragraphState) ?? paragraphState;

  expect(serializeDocument(createDocumentFromEditorState(paragraphState))).toBe("alpha\n\n\n\n");

  const nextParagraphs = paragraphState.documentIndex.regions.filter(
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
  let quoteState = createEditorState(parseDocument("> quoted text\n"));
  const quoted = quoteState.documentIndex.regions.find(
    (container) => container.text === "quoted text",
  );

  if (!quoted) {
    throw new Error("Expected quoted container");
  }

  quoteState = setSelection(quoteState, {
    regionId: quoted.id,
    offset: "quoted".length,
  });
  quoteState = insertLineBreak(quoteState) ?? quoteState;

  expect(serializeDocument(createDocumentFromEditorState(quoteState))).toBe(
    "> quoted\n>\n> &#x20;text\n",
  );

  let codeState = createEditorState(parseDocument("```ts\nconst x = 1;\n```\n"));
  const code = codeState.documentIndex.regions.find((container) => container.blockType === "code");

  if (!code) {
    throw new Error("Expected code container");
  }

  codeState = setSelection(codeState, {
    regionId: code.id,
    offset: code.text.length,
  });
  codeState = insertLineBreak(codeState) ?? codeState;

  expect(serializeDocument(createDocumentFromEditorState(codeState))).toBe(
    "```ts\nconst x = 1;\n\n```\n",
  );
});

test("pressing enter on an empty blockquote line exits to a paragraph", () => {
  let quoteState = createEditorState(parseDocument("> alpha\n"));
  const alpha = quoteState.documentIndex.regions.find((container) => container.text === "alpha");

  if (!alpha) {
    throw new Error("Expected quoted alpha container");
  }

  quoteState = setSelection(quoteState, {
    regionId: alpha.id,
    offset: alpha.text.length,
  });
  quoteState = insertLineBreak(quoteState) ?? quoteState;

  const empty = quoteState.documentIndex.regions.find((container) => container.text === "");

  if (!empty) {
    throw new Error("Expected empty quoted container");
  }

  quoteState = setSelection(quoteState, {
    regionId: empty.id,
    offset: 0,
  });
  quoteState = insertLineBreak(quoteState) ?? quoteState;

  expect(serializeDocument(createDocumentFromEditorState(quoteState))).toBe("> alpha\n\n");
});

test("re-enters the preceding blockquote when backspacing from the empty paragraph after exit", () => {
  let quoteState = createEditorState(parseDocument("> alpha\n"));
  const alpha = quoteState.documentIndex.regions.find((container) => container.text === "alpha");

  if (!alpha) {
    throw new Error("Expected quoted alpha container");
  }

  quoteState = setSelection(quoteState, {
    regionId: alpha.id,
    offset: alpha.text.length,
  });
  quoteState = insertLineBreak(quoteState) ?? quoteState;
  quoteState = insertLineBreak(quoteState) ?? quoteState;

  const emptyParagraph = quoteState.documentIndex.regions.find(
    (container) => container.blockType === "paragraph" && container.text === "",
  );

  if (!emptyParagraph) {
    throw new Error("Expected empty paragraph after blockquote exit");
  }

  quoteState = setSelection(quoteState, {
    regionId: emptyParagraph.id,
    offset: 0,
  });
  quoteState = deleteBackward(quoteState) ?? quoteState;

  expect(serializeDocument(createDocumentFromEditorState(quoteState))).toBe("> alpha\n");
  expect(quoteState.selection.focus.regionId).toBe(alpha.id);
  expect(quoteState.selection.focus.offset).toBe(alpha.text.length);
});

test("backspacing on an empty quoted line removes it without unwrapping the blockquote", () => {
  let quoteState = createEditorState(parseDocument("> alpha\n"));
  const alpha = quoteState.documentIndex.regions.find((container) => container.text === "alpha");

  if (!alpha) {
    throw new Error("Expected quoted alpha container");
  }

  quoteState = setSelection(quoteState, {
    regionId: alpha.id,
    offset: alpha.text.length,
  });
  quoteState = insertLineBreak(quoteState) ?? quoteState;

  const empty = quoteState.documentIndex.regions.find((container) => container.text === "");

  if (!empty) {
    throw new Error("Expected empty quoted container");
  }

  quoteState = setSelection(quoteState, {
    regionId: empty.id,
    offset: 0,
  });
  quoteState = deleteBackward(quoteState) ?? quoteState;

  expect(serializeDocument(createDocumentFromEditorState(quoteState))).toBe("> alpha\n");
  expect(quoteState.selection.focus.regionId).toBe(alpha.id);
  expect(quoteState.selection.focus.offset).toBe(alpha.text.length);
});

test("changes heading depth with tab and shift-tab", () => {
  let headingState = createEditorState(parseDocument("## Heading\n"));
  const heading = headingState.documentIndex.regions.find(
    (container) => container.blockType === "heading",
  );

  if (!heading) {
    throw new Error("Expected heading container");
  }

  headingState = setSelection(headingState, {
    regionId: heading.id,
    offset: 3,
  });
  headingState = indent(headingState) ?? headingState;

  expect(serializeDocument(createDocumentFromEditorState(headingState))).toBe("### Heading\n");
  expect(headingState.selection.focus.offset).toBe(3);

  headingState = dedent(headingState) ?? headingState;

  expect(serializeDocument(createDocumentFromEditorState(headingState))).toBe("## Heading\n");
  expect(headingState.selection.focus.offset).toBe(3);

  let h1State = createEditorState(parseDocument("# Heading\n"));
  const h1 = h1State.documentIndex.regions.find((container) => container.blockType === "heading");

  if (!h1) {
    throw new Error("Expected h1 container");
  }

  h1State = setSelection(h1State, {
    regionId: h1.id,
    offset: 2,
  });
  h1State = dedent(h1State) ?? h1State;

  expect(serializeDocument(createDocumentFromEditorState(h1State))).toBe("# Heading\n");

  let h6State = createEditorState(parseDocument("###### Heading\n"));
  const h6 = h6State.documentIndex.regions.find((container) => container.blockType === "heading");

  if (!h6) {
    throw new Error("Expected h6 container");
  }

  h6State = setSelection(h6State, {
    regionId: h6.id,
    offset: 2,
  });
  h6State = indent(h6State) ?? h6State;

  expect(serializeDocument(createDocumentFromEditorState(h6State))).toBe("###### Heading\n");
});

test("merges a non-empty quoted line with the previous line when backspacing at its start", () => {
  let quoteState = createEditorState(parseDocument("> alpha\n"));
  const alpha = quoteState.documentIndex.regions.find((container) => container.text === "alpha");

  if (!alpha) {
    throw new Error("Expected alpha container");
  }

  quoteState = setSelection(quoteState, { regionId: alpha.id, offset: alpha.text.length });
  quoteState = insertLineBreak(quoteState) ?? quoteState;

  const empty = quoteState.documentIndex.regions.find((container) => container.text === "");

  if (!empty) {
    throw new Error("Expected empty quoted container");
  }

  quoteState = setSelection(quoteState, { regionId: empty.id, offset: 0 });
  quoteState = insertText(quoteState, "beta") ?? quoteState;

  const beta = quoteState.documentIndex.regions.find((container) => container.text === "beta");

  if (!beta) {
    throw new Error("Expected beta container");
  }

  quoteState = setSelection(quoteState, { regionId: beta.id, offset: 0 });
  quoteState = deleteBackward(quoteState) ?? quoteState;

  expect(serializeDocument(createDocumentFromEditorState(quoteState))).toBe("> alphabeta\n");

  const merged = quoteState.documentIndex.regions.find((container) => container.text === "alphabeta");

  if (!merged) {
    throw new Error("Expected merged container");
  }

  expect(quoteState.selection.focus.regionId).toBe(merged.id);
  expect(quoteState.selection.focus.offset).toBe("alpha".length);
});

test("places cursor at the merge junction when backspacing at the start of a block", () => {
  let state = createEditorState(parseDocument("First\n\nSecond\n"));
  const second = state.documentIndex.regions.find((container) => container.text === "Second");

  if (!second) {
    throw new Error("Expected second paragraph");
  }

  state = setSelection(state, { regionId: second.id, offset: 0 });
  state = deleteBackward(state) ?? state;

  expect(serializeDocument(createDocumentFromEditorState(state))).toBe("FirstSecond\n");

  const merged = state.documentIndex.regions.find((container) => container.text === "FirstSecond");

  if (!merged) {
    throw new Error("Expected merged container");
  }

  expect(state.selection.focus.regionId).toBe(merged.id);
  expect(state.selection.focus.offset).toBe("First".length);
});
