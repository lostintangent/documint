import { describe, expect, test } from "bun:test";
import { dedent, deleteBackward, deleteForward, deleteSelection, indent, insertLineBreak, insertText } from "@/editor/state";
import { getRegion, getRegionByType, placeAt, selectIn, setup, toMarkdown } from "../../helpers";

test("demotes headings and unwraps single-line blockquotes on backspace at start", () => {
  // Heading and blockquote share the "block demotion" override: at the
  // start of a wrapped construct, backspace strips the wrapping in
  // favor of the underlying content. Both run before the universal
  // in-flow rule so they preempt any text-merge into the previous root.
  let headingState = setup("# Heading\n");
  const heading = getRegion(headingState, "Heading");

  headingState = placeAt(headingState, heading, 0);
  headingState = deleteBackward(headingState) ?? headingState;

  expect(toMarkdown(headingState)).toBe("Heading\n");

  let quoteState = setup("> quoted line\n");
  const quoted = getRegion(quoteState, "quoted line");

  quoteState = placeAt(quoteState, quoted, 0);
  quoteState = deleteBackward(quoteState) ?? quoteState;

  expect(toMarkdown(quoteState)).toBe("quoted line\n");
});

test("backspace at start of a non-empty top-level first list item demotes the whole list to paragraphs", () => {
  // Top-level first-item backspace removes the list container itself.
  // Every item in the list becomes a root paragraph in document order,
  // matching the block-demotion semantics used by headings and quotes.
  let state = setup("- alpha\n  - nested\n- bravo\n");
  const alpha = getRegion(state, "alpha");

  state = placeAt(state, alpha, 0);
  state = deleteBackward(state) ?? state;

  expect(toMarkdown(state)).toBe(
    "alpha\n\nnested\n\nbravo\n",
  );
  expect(state.selection.focus.offset).toBe(0);
});

test("backspace at start of a top-level list still demotes it when a previous root exists", () => {
  let state = setup("Lead\n\n- alpha\n- bravo\n");
  const alpha = getRegion(state, "alpha");

  state = placeAt(state, alpha, 0);
  state = deleteBackward(state) ?? state;

  expect(toMarkdown(state)).toBe(
    "Lead\n\nalpha\n\nbravo\n",
  );
});

test("backspace at start of an empty top-level first list item still demotes the list", () => {
  // Symmetric with empty heading + empty single-line blockquote: the
  // demote override fires regardless of whether the first item is
  // empty. Without this, an empty first item would fall through to the
  // universal in-flow rule, which would silently delete the item and
  // jump the cursor up — a different gesture than what users get from
  // the heading/blockquote/list demote family.
  let state = setup("Lead\n\n-\n- alpha\n");
  const empty = state.documentIndex.regions.find(
    (c) => c.blockType === "paragraph" && c.text === "",
  );

  if (!empty) throw new Error("Expected empty first list item");

  state = placeAt(state, empty, 0);
  state = deleteBackward(state) ?? state;

  // The list is gone; first item became an empty paragraph, second
  // item became a paragraph "alpha". Cursor lands at start of the new
  // empty paragraph.
  expect(toMarkdown(state)).toBe("Lead\n\n\n\nalpha\n");
});

test("backspace at start of a single-item top-level list demotes it to a paragraph instead of merging upward", () => {
  let state = setup("Lead\n\n- alpha\n");
  const alpha = getRegion(state, "alpha");

  state = placeAt(state, alpha, 0);
  state = deleteBackward(state) ?? state;

  const paragraph = state.documentIndex.regions.find((c) => c.text === "alpha");

  expect(toMarkdown(state)).toBe("Lead\n\nalpha\n");
  expect(state.selection.focus.regionId).toBe(paragraph!.id);
  expect(state.selection.focus.offset).toBe(0);
});

test("backspace at start of a non-empty first task item outdents and drops the task marker", () => {
  // Task markers are no longer specially removed on backspace; the
  // universal first-item outdent applies, and the marker simply isn't
  // part of the leading paragraph's plain text, so the resulting
  // paragraph contains only the item's content.
  let state = setup("- [ ] alpha\n");
  const alpha = getRegion(state, "alpha");

  state = placeAt(state, alpha, 0);
  state = deleteBackward(state) ?? state;

  expect(toMarkdown(state)).toBe("alpha\n");
});

test("merges or removes blocks when backspacing at the start", () => {
  let paragraphState = setup("First\n\nSecond\n");
  const second = getRegion(paragraphState, "Second");

  paragraphState = placeAt(paragraphState, second, 0);
  paragraphState = deleteBackward(paragraphState) ?? paragraphState;

  expect(toMarkdown(paragraphState)).toBe("FirstSecond\n");

  let blankParagraphState = setup("First\n");
  const first = getRegion(blankParagraphState, "First");

  blankParagraphState = placeAt(blankParagraphState, first, first.text.length);
  blankParagraphState = insertLineBreak(blankParagraphState) ?? blankParagraphState;

  const blankParagraph = getRegion(blankParagraphState, "");

  blankParagraphState = placeAt(blankParagraphState, blankParagraph, 0);
  blankParagraphState = deleteBackward(blankParagraphState) ?? blankParagraphState;

  expect(toMarkdown(blankParagraphState)).toBe("First\n");
});

test("splits paragraphs and extends headings through enter", () => {
  let paragraphState = setup("Paragraph body.\n");
  const paragraph = paragraphState.documentIndex.regions[0];

  if (!paragraph) {
    throw new Error("Expected paragraph container");
  }

  paragraphState = placeAt(paragraphState, paragraph, "Paragraph".length);
  paragraphState = insertLineBreak(paragraphState) ?? paragraphState;

  expect(toMarkdown(paragraphState)).toBe(
    "Paragraph\n\n&#x20;body.\n",
  );

  let headingState = setup("# Heading\n");
  const heading = headingState.documentIndex.regions[0];

  if (!heading) {
    throw new Error("Expected heading container");
  }

  headingState = placeAt(headingState, heading, heading.text.length);
  headingState = insertLineBreak(headingState) ?? headingState;

  expect(toMarkdown(headingState)).toBe("# Heading\n\n");
});

test("forward delete at end of a non-empty paragraph merges the next paragraph into it", () => {
  // Symmetric to backspace at the start of a non-empty block: the
  // universal in-flow rule folds the next region into the current
  // one. Cursor stays at the original end of the current region —
  // the merge point.
  let state = setup("First\n\nSecond\n");
  const first = getRegion(state, "First");

  state = placeAt(state, first, first.text.length);
  state = deleteForward(state) ?? state;

  const merged = getRegion(state, "FirstSecond");

  expect(toMarkdown(state)).toBe("FirstSecond\n");
  expect(state.selection.focus.regionId).toBe(merged.id);
  expect(state.selection.focus.offset).toBe("First".length);
});

test("forward delete at end of a paragraph followed by a list absorbs the first list item into the paragraph", () => {
  // Cross-root forward merge: the universal rule keeps the current
  // region as the absorber and removes the neighbor's containing
  // block. So `Lead` survives as a root paragraph (now carrying the
  // first item's text) and the list loses its first item — symmetric
  // with the paragraph + paragraph forward merge.
  let state = setup("Lead\n\n- alpha\n- bravo\n");
  const lead = getRegion(state, "Lead");

  state = placeAt(state, lead, lead.text.length);
  state = deleteForward(state) ?? state;

  expect(toMarkdown(state)).toBe(
    "Leadalpha\n\n- bravo\n",
  );
  const merged = state.documentIndex.regions.find((c) => c.text === "Leadalpha");
  expect(state.selection.focus.regionId).toBe(merged!.id);
  expect(state.selection.focus.offset).toBe("Lead".length);
});

test("forward delete removes an empty paragraph and moves the caret to the next block", () => {
  let state = setup("First\n\nSecond\n");
  const second = getRegion(state, "Second");

  state = placeAt(state, second, 0);
  state = insertLineBreak(state) ?? state;

  const emptyParagraph = state.documentIndex.regions.find(
    (container) => container.blockType === "paragraph" && container.text === "",
  );

  if (!emptyParagraph) {
    throw new Error("Expected empty paragraph");
  }

  state = placeAt(state, emptyParagraph, 0);
  state = deleteForward(state) ?? state;

  const nextParagraph = getRegion(state, "Second");

  expect(toMarkdown(state)).toBe("First\n\nSecond\n");
  expect(state.documentIndex.regions.filter((container) => container.text === "")).toHaveLength(0);
  expect(state.selection.focus.regionId).toBe(nextParagraph.id);
  expect(state.selection.focus.offset).toBe(0);
});

test("forward delete removes an empty heading and moves the caret to the next block", () => {
  let state = setup("# Heading\n\nAfter\n");
  const heading = getRegion(state, "Heading");

  state = selectIn(state, heading, 0, heading.text.length);
  state = deleteSelection(state);

  const emptyHeading = state.documentIndex.regions.find(
    (container) => container.blockType === "heading" && container.text === "",
  );

  if (!emptyHeading) {
    throw new Error("Expected empty heading");
  }

  state = placeAt(state, emptyHeading, 0);
  state = deleteForward(state) ?? state;

  const after = getRegion(state, "After");

  expect(toMarkdown(state)).toBe("After\n");
  expect(state.selection.focus.regionId).toBe(after.id);
  expect(state.selection.focus.offset).toBe(0);
});

test("forward delete is a no-op on the last empty paragraph in the document", () => {
  let state = setup("First\n");
  const first = getRegion(state, "First");

  state = placeAt(state, first, first.text.length);
  state = insertLineBreak(state) ?? state;

  const emptyParagraph = state.documentIndex.regions.find(
    (container) => container.blockType === "paragraph" && container.text === "",
  );

  if (!emptyParagraph) {
    throw new Error("Expected empty paragraph");
  }

  const placed = placeAt(state, emptyParagraph, 0);

  expect(deleteForward(placed)).toBeNull();
});

test("backspacing an empty paragraph after a list lands in the deepest-last region of the list", () => {
  let state = setup("- top\n  - nested\n\nstub\n");
  const stub = getRegion(state, "stub");

  // Insert an empty paragraph above "stub" so the document becomes:
  //   - top
  //     - nested
  //   <empty paragraph>
  //   stub
  state = placeAt(state, stub, 0);
  state = insertLineBreak(state) ?? state;

  const emptyParagraph = state.documentIndex.regions.find(
    (container) => container.blockType === "paragraph" && container.text === "",
  );

  if (!emptyParagraph) {
    throw new Error("Expected empty paragraph");
  }

  state = placeAt(state, emptyParagraph, 0);
  state = deleteBackward(state) ?? state;

  const nested = getRegion(state, "nested");

  expect(toMarkdown(state)).toBe(
    "- top\n  - nested\n\nstub\n",
  );
  // The caret should land where the left arrow would take us — at the end
  // of the nested item, not the end of the top-level item.
  expect(state.selection.focus.regionId).toBe(nested.id);
  expect(state.selection.focus.offset).toBe(nested.text.length);
});

test("forward-deleting an empty paragraph above a list lands at the start of the first item", () => {
  let state = setup("stub\n\n- top\n  - nested\n");
  const stub = getRegion(state, "stub");

  // Replace "stub" with an empty paragraph, leaving:
  //   <empty paragraph>
  //   - top
  //     - nested
  state = selectIn(state, stub, 0, stub.text.length);
  state = deleteSelection(state);

  const emptyParagraph = state.documentIndex.regions.find(
    (container) => container.blockType === "paragraph" && container.text === "",
  );

  if (!emptyParagraph) {
    throw new Error("Expected empty paragraph");
  }

  state = placeAt(state, emptyParagraph, 0);
  state = deleteForward(state) ?? state;

  const top = getRegion(state, "top");

  expect(toMarkdown(state)).toBe("- top\n  - nested\n");
  expect(state.selection.focus.regionId).toBe(top.id);
  expect(state.selection.focus.offset).toBe(0);
});

test("moves the caret into the newly inserted empty paragraph when pressing enter on an empty paragraph", () => {
  let paragraphState = setup("alpha\n");
  const paragraph = paragraphState.documentIndex.regions[0];

  if (!paragraph) {
    throw new Error("Expected paragraph container");
  }

  paragraphState = placeAt(paragraphState, paragraph, paragraph.text.length);
  paragraphState = insertLineBreak(paragraphState) ?? paragraphState;

  const emptyParagraph = paragraphState.documentIndex.regions.find(
    (container) => container.blockType === "paragraph" && container.text === "",
  );

  if (!emptyParagraph) {
    throw new Error("Expected empty paragraph container");
  }

  paragraphState = placeAt(paragraphState, emptyParagraph, 0);
  paragraphState = insertLineBreak(paragraphState) ?? paragraphState;

  expect(toMarkdown(paragraphState)).toBe("alpha\n\n\n\n");

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
  let quoteState = setup("> quoted text\n");
  const quoted = getRegion(quoteState, "quoted text");

  quoteState = placeAt(quoteState, quoted, "quoted".length);
  quoteState = insertLineBreak(quoteState) ?? quoteState;

  expect(toMarkdown(quoteState)).toBe(
    "> quoted\n>\n> &#x20;text\n",
  );

  let codeState = setup("```ts\nconst x = 1;\n```\n");
  const code = getRegionByType(codeState, "code");

  codeState = placeAt(codeState, code, code.text.length);
  codeState = insertLineBreak(codeState) ?? codeState;

  expect(toMarkdown(codeState)).toBe(
    "```ts\nconst x = 1;\n\n```\n",
  );
});

test("pressing enter on an empty blockquote line exits to a paragraph", () => {
  let quoteState = setup("> alpha\n");
  const alpha = getRegion(quoteState, "alpha");

  quoteState = placeAt(quoteState, alpha, alpha.text.length);
  quoteState = insertLineBreak(quoteState) ?? quoteState;

  const empty = quoteState.documentIndex.regions.find((container) => container.text === "");

  if (!empty) {
    throw new Error("Expected empty quoted container");
  }

  quoteState = placeAt(quoteState, empty, 0);
  quoteState = insertLineBreak(quoteState) ?? quoteState;

  expect(toMarkdown(quoteState)).toBe("> alpha\n\n");
});

test("re-enters the preceding blockquote when backspacing from the empty paragraph after exit", () => {
  let quoteState = setup("> alpha\n");
  const alpha = getRegion(quoteState, "alpha");

  quoteState = placeAt(quoteState, alpha, alpha.text.length);
  quoteState = insertLineBreak(quoteState) ?? quoteState;
  quoteState = insertLineBreak(quoteState) ?? quoteState;

  const emptyParagraph = quoteState.documentIndex.regions.find(
    (container) => container.blockType === "paragraph" && container.text === "",
  );

  if (!emptyParagraph) {
    throw new Error("Expected empty paragraph after blockquote exit");
  }

  quoteState = placeAt(quoteState, emptyParagraph, 0);
  quoteState = deleteBackward(quoteState) ?? quoteState;

  expect(toMarkdown(quoteState)).toBe("> alpha\n");
  expect(quoteState.selection.focus.regionId).toBe(alpha.id);
  expect(quoteState.selection.focus.offset).toBe(alpha.text.length);
});

test("backspacing on an empty quoted line removes it without unwrapping the blockquote", () => {
  let quoteState = setup("> alpha\n");
  const alpha = getRegion(quoteState, "alpha");

  quoteState = placeAt(quoteState, alpha, alpha.text.length);
  quoteState = insertLineBreak(quoteState) ?? quoteState;

  const empty = quoteState.documentIndex.regions.find((container) => container.text === "");

  if (!empty) {
    throw new Error("Expected empty quoted container");
  }

  quoteState = placeAt(quoteState, empty, 0);
  quoteState = deleteBackward(quoteState) ?? quoteState;

  expect(toMarkdown(quoteState)).toBe("> alpha\n");
  expect(quoteState.selection.focus.regionId).toBe(alpha.id);
  expect(quoteState.selection.focus.offset).toBe(alpha.text.length);
});

test("forward delete is a no-op on the last empty quoted line in the document", () => {
  // Forward delete with no next-in-flow neighbor is uniformly a no-op
  // under the universal in-flow rule — same as forward-delete on the
  // last empty paragraph at the document boundary. Backward delete
  // (covered by the test above) is what removes it.
  let quoteState = setup("> alpha\n");
  const alpha = getRegion(quoteState, "alpha");

  quoteState = placeAt(quoteState, alpha, alpha.text.length);
  quoteState = insertLineBreak(quoteState) ?? quoteState;

  const empty = quoteState.documentIndex.regions.find((container) => container.text === "");

  if (!empty) {
    throw new Error("Expected empty quoted container");
  }

  const placed = placeAt(quoteState, empty, 0);

  expect(deleteForward(placed)).toBeNull();
});

test("changes heading depth with tab and shift-tab", () => {
  let headingState = setup("## Heading\n");
  const heading = headingState.documentIndex.regions.find(
    (container) => container.blockType === "heading",
  );

  if (!heading) {
    throw new Error("Expected heading container");
  }

  headingState = placeAt(headingState, heading, 3);
  headingState = indent(headingState) ?? headingState;

  expect(toMarkdown(headingState)).toBe("### Heading\n");
  expect(headingState.selection.focus.offset).toBe(3);

  headingState = dedent(headingState) ?? headingState;

  expect(toMarkdown(headingState)).toBe("## Heading\n");
  expect(headingState.selection.focus.offset).toBe(3);

  let h1State = setup("# Heading\n");
  const h1 = getRegionByType(h1State, "heading");

  h1State = placeAt(h1State, h1, 2);
  h1State = dedent(h1State) ?? h1State;

  expect(toMarkdown(h1State)).toBe("# Heading\n");

  let h6State = setup("###### Heading\n");
  const h6 = getRegionByType(h6State, "heading");

  h6State = placeAt(h6State, h6, 2);
  h6State = indent(h6State) ?? h6State;

  expect(toMarkdown(h6State)).toBe("###### Heading\n");
});

test("merges a non-empty quoted line with the previous line when backspacing at its start", () => {
  let quoteState = setup("> alpha\n");
  const alpha = getRegion(quoteState, "alpha");

  quoteState = placeAt(quoteState, alpha, alpha.text.length);
  quoteState = insertLineBreak(quoteState) ?? quoteState;

  const empty = quoteState.documentIndex.regions.find((container) => container.text === "");

  if (!empty) {
    throw new Error("Expected empty quoted container");
  }

  quoteState = placeAt(quoteState, empty, 0);
  quoteState = insertText(quoteState, "beta") ?? quoteState;

  const beta = getRegion(quoteState, "beta");

  quoteState = placeAt(quoteState, beta, 0);
  quoteState = deleteBackward(quoteState) ?? quoteState;

  expect(toMarkdown(quoteState)).toBe("> alphabeta\n");

  const merged = getRegion(quoteState, "alphabeta");

  expect(quoteState.selection.focus.regionId).toBe(merged.id);
  expect(quoteState.selection.focus.offset).toBe("alpha".length);
});

test("places the cursor at the merge junction when backspacing past the first child of a blockquote", () => {
  // Same regression as the multi-item-list case in
  // commands/list/structure.test.ts — the merge-cursor target used to
  // walk the rebuilt tree by id and short-circuit on the outer
  // container, which cascaded primary-region resolution to the first
  // leaf (the wrong line). Now path-based targeting lands the cursor
  // at the seam in the actual merged child, regardless of how many
  // siblings precede it.
  let state = setup("> alpha\n>\n> bravo\n>\n> charlie\n");
  const charlie = getRegion(state, "charlie");

  state = placeAt(state, charlie, 0);
  state = deleteBackward(state) ?? state;

  const merged = getRegion(state, "bravocharlie");

  expect(toMarkdown(state)).toBe(
    "> alpha\n>\n> bravocharlie\n",
  );
  expect(state.selection.focus.regionId).toBe(merged.id);
  expect(state.selection.focus.offset).toBe("bravo".length);
});

test("places cursor at the merge junction when backspacing at the start of a block", () => {
  let state = setup("First\n\nSecond\n");
  const second = getRegion(state, "Second");

  state = placeAt(state, second, 0);
  state = deleteBackward(state) ?? state;

  expect(toMarkdown(state)).toBe("FirstSecond\n");

  const merged = getRegion(state, "FirstSecond");

  expect(state.selection.focus.regionId).toBe(merged.id);
  expect(state.selection.focus.offset).toBe("First".length);
});

// Inert leaf blocks (divider today; image-as-block / embed /
// display-math in the future) contribute no region. The universal
// merge-collapse rule has nothing to merge into for these — the
// dedicated inert-neighbor branch removes them as a unit and leaves
// the caret where it was. Without this branch, backspace at the
// boundary of a region next to an inert block would either no-op
// (the pre-refactor empty-region world) or silently merge through the
// inert block (the post-refactor world, since inert isn't a region).
describe("Dividers", () => {
  test("backspace at start of paragraph after a divider removes the divider, caret stays put", () => {
    let state = setup("alpha\n\n---\n\nbeta\n");
    const beta = getRegion(state, "beta");

    state = placeAt(state, beta, 0);
    state = deleteBackward(state) ?? state;

    expect(toMarkdown(state)).toBe("alpha\n\nbeta\n");
    const survivor = getRegion(state, "beta");
    expect(state.selection.focus.regionId).toBe(survivor.id);
    expect(state.selection.focus.offset).toBe(0);
  });

  test("forward delete at end of paragraph before a divider removes the divider, caret stays put", () => {
    let state = setup("alpha\n\n---\n\nbeta\n");
    const alpha = getRegion(state, "alpha");

    state = placeAt(state, alpha, "end");
    state = deleteForward(state) ?? state;

    expect(toMarkdown(state)).toBe("alpha\n\nbeta\n");
    const survivor = getRegion(state, "alpha");
    expect(state.selection.focus.regionId).toBe(survivor.id);
    expect(state.selection.focus.offset).toBe("alpha".length);
  });

  test("backspace through consecutive dividers removes one at a time", () => {
    let state = setup("alpha\n\n---\n\n---\n\nbeta\n");
    const beta = getRegion(state, "beta");

    state = placeAt(state, beta, 0);
    state = deleteBackward(state) ?? state;
    expect(toMarkdown(state)).toBe("alpha\n\n---\n\nbeta\n");
    expect(state.selection.focus.offset).toBe(0);

    state = deleteBackward(state) ?? state;
    expect(toMarkdown(state)).toBe("alpha\n\nbeta\n");
    expect(state.selection.focus.offset).toBe(0);

    // After all dividers are gone, the next backspace performs the
    // normal text merge into the previous paragraph.
    state = deleteBackward(state) ?? state;
    expect(toMarkdown(state)).toBe("alphabeta\n");
  });
});
