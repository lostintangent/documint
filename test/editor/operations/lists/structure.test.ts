import { expect, test } from "bun:test";
import {
  applyTextInputRule,
  dispatchKey,
  handleStructuralBackspace,
  moveListItemDown,
  moveListItemUp,
  splitSelectionListItem,
  splitStructuralBlock,
  toggleTaskItem,
} from "@/editor/model/commands";
import {
  createDocumentFromEditorState,
  createEditorState,
  redoEditorState,
  setCanvasSelection as setSelection,
  undoEditorState,
} from "@/editor/model/state";
import { parseMarkdown, serializeMarkdown } from "@/markdown";

test("supports canvas list splits with undo and redo", () => {
  let state = createEditorState(parseMarkdown("- alpha\n- beta\n"));
  const target = state.documentEditor.regions.find((container) => container.text === "beta");

  if (!target) {
    throw new Error("Expected beta container");
  }

  state = setSelection(state, {
    regionId: target.id,
    offset: 2,
  });

  const splitState = splitSelectionListItem(state);

  if (!splitState) {
    throw new Error("Expected split state");
  }

  state = splitState;

  expect(serializeMarkdown(createDocumentFromEditorState(state))).toBe("- alpha\n- be\n- ta\n");

  state = undoEditorState(state);
  expect(serializeMarkdown(createDocumentFromEditorState(state))).toBe("- alpha\n- beta\n");

  state = redoEditorState(state);
  expect(serializeMarkdown(createDocumentFromEditorState(state))).toBe("- alpha\n- be\n- ta\n");
});

test("moves top-level list items up and down while preserving their nested subtree", () => {
  let state = createEditorState(parseMarkdown("- alpha\n  - child\n- beta\n- gamma\n"));
  const alpha = state.documentEditor.regions.find((container) => container.text === "alpha");

  if (!alpha) {
    throw new Error("Expected alpha container");
  }

  state = setSelection(state, {
    regionId: alpha.id,
    offset: 0,
  });
  state = moveListItemDown(state) ?? state;

  expect(serializeMarkdown(createDocumentFromEditorState(state))).toBe("- beta\n- alpha\n  - child\n- gamma\n");

  state = moveListItemUp(state) ?? state;

  expect(serializeMarkdown(createDocumentFromEditorState(state))).toBe("- alpha\n  - child\n- beta\n- gamma\n");
});

test("moves nested list items only within their current parent list", () => {
  let state = createEditorState(parseMarkdown("- parent\n  - first\n  - second\n  - third\n"));
  const second = state.documentEditor.regions.find((container) => container.text === "second");

  if (!second) {
    throw new Error("Expected second container");
  }

  state = setSelection(state, {
    regionId: second.id,
    offset: 0,
  });
  state = moveListItemUp(state) ?? state;

  expect(serializeMarkdown(createDocumentFromEditorState(state))).toBe("- parent\n  - second\n  - first\n  - third\n");

  state = moveListItemDown(state) ?? state;

  expect(serializeMarkdown(createDocumentFromEditorState(state))).toBe("- parent\n  - first\n  - second\n  - third\n");
});

test("does not move list items past the boundaries of their current parent list", () => {
  let state = createEditorState(parseMarkdown("- alpha\n- beta\n"));
  const alpha = state.documentEditor.regions.find((container) => container.text === "alpha");
  const beta = state.documentEditor.regions.find((container) => container.text === "beta");

  if (!alpha || !beta) {
    throw new Error("Expected top-level list regions");
  }

  state = setSelection(state, {
    regionId: alpha.id,
    offset: 0,
  });

  expect(moveListItemUp(state)).toBeNull();

  state = setSelection(state, {
    regionId: beta.id,
    offset: 0,
  });

  expect(moveListItemDown(state)).toBeNull();
});

test("routes list item move commands through the editor command layer", () => {
  let state = createEditorState(parseMarkdown("- alpha\n- beta\n"));
  const beta = state.documentEditor.regions.find((container) => container.text === "beta");

  if (!beta) {
    throw new Error("Expected beta container");
  }

  state = setSelection(state, {
    regionId: beta.id,
    offset: 0,
  });
  state = dispatchKey(state, "moveListItemUp") ?? state;

  expect(serializeMarkdown(createDocumentFromEditorState(state))).toBe("- beta\n- alpha\n");
});

test("inserts new list items above or below at list boundaries", () => {
  let state = createEditorState(parseMarkdown("- alpha\n- beta\n"));
  const alpha = state.documentEditor.regions.find((container) => container.text === "alpha");

  if (!alpha) {
    throw new Error("Expected alpha container");
  }

  state = setSelection(state, {
    regionId: alpha.id,
    offset: 0,
  });
  state = splitSelectionListItem(state) ?? state;

  expect(serializeMarkdown(createDocumentFromEditorState(state))).toBe("-\n- alpha\n- beta\n");

  const beta = state.documentEditor.regions.find((container) => container.text === "beta");

  if (!beta) {
    throw new Error("Expected beta container");
  }

  state = setSelection(state, {
    regionId: beta.id,
    offset: beta.text.length,
  });
  state = splitSelectionListItem(state) ?? state;

  expect(serializeMarkdown(createDocumentFromEditorState(state))).toBe("-\n- alpha\n- beta\n-\n");
});

test("exits empty top-level list items through the structural enter path", () => {
  let state = createEditorState(parseMarkdown("- alpha\n- beta\n"));
  const target = state.documentEditor.regions.find((container) => container.text === "beta");

  if (!target) {
    throw new Error("Expected beta container");
  }

  state = setSelection(state, {
    regionId: target.id,
    offset: 0,
  });
  state = splitSelectionListItem(state) ?? state;

  const empty = state.documentEditor.regions.find((container) => container.text === "");

  if (!empty) {
    throw new Error("Expected empty item");
  }

  state = setSelection(state, {
    regionId: empty.id,
    offset: 0,
  });
  state = splitStructuralBlock(state) ?? state;

  expect(serializeMarkdown(createDocumentFromEditorState(state))).toBe("- alpha\n\n\n\n- beta\n");
});

test("rejoins adjacent compatible lists when deleting the empty paragraph between them", () => {
  let state = createEditorState(parseMarkdown("- alpha\n- beta\n"));
  const beta = state.documentEditor.regions.find((container) => container.text === "beta");

  if (!beta) {
    throw new Error("Expected beta container");
  }

  state = setSelection(state, {
    regionId: beta.id,
    offset: 0,
  });
  state = splitSelectionListItem(state) ?? state;

  const emptyItem = state.documentEditor.regions.find((container) => container.text === "");

  if (!emptyItem) {
    throw new Error("Expected empty list item");
  }

  state = setSelection(state, {
    regionId: emptyItem.id,
    offset: 0,
  });
  state = splitStructuralBlock(state) ?? state;

  const paragraph = state.documentEditor.regions.find((container) => container.text === "");

  if (!paragraph) {
    throw new Error("Expected empty paragraph between lists");
  }

  state = setSelection(state, {
    regionId: paragraph.id,
    offset: 0,
  });
  state = handleStructuralBackspace(state) ?? state;

  expect(serializeMarkdown(createDocumentFromEditorState(state))).toBe("- alpha\n- beta\n");
});

test("lifts empty nested list items one level before exiting the list entirely", () => {
  let state = createEditorState(parseMarkdown("- parent\n  - child\n  - \n- sibling\n"));
  const empty = state.documentEditor.regions.find(
    (container) => container.text === "" && container.path.includes(".children.0.children."),
  );

  if (!empty) {
    throw new Error("Expected empty nested list item");
  }

  state = setSelection(state, {
    regionId: empty.id,
    offset: 0,
  });
  state = splitStructuralBlock(state) ?? state;

  expect(serializeMarkdown(createDocumentFromEditorState(state))).toBe("- parent\n  - child\n-\n- sibling\n");
});

test("routes list enter behavior and markdown task rules", () => {
  let state = createEditorState(parseMarkdown("- [x] shipped baseline\n"));
  const task = state.documentEditor.regions.find((container) => container.text === "shipped baseline");

  if (!task) {
    throw new Error("Expected shipped baseline container");
  }

  state = setSelection(state, {
    regionId: task.id,
    offset: "shipped b".length,
  });
  state = dispatchKey(state, "insertLineBreak") ?? state;

  expect(serializeMarkdown(createDocumentFromEditorState(state))).toBe("- [x] shipped b\n- [ ] aseline\n");

  let inputState = createEditorState(parseMarkdown("x\n"));
  const placeholder = inputState.documentEditor.regions[0];

  if (!placeholder) {
    throw new Error("Expected placeholder container");
  }

  inputState = setSelection(inputState, {
    anchor: {
      regionId: placeholder.id,
      offset: 0,
    },
    focus: {
      regionId: placeholder.id,
      offset: placeholder.text.length,
    },
  });

  const taskRuleState = applyTextInputRule(inputState, "- [ ] ");

  if (!taskRuleState || "documentEditor" in taskRuleState === false) {
    throw new Error("Expected canvas state from task rule");
  }

  expect(serializeMarkdown(createDocumentFromEditorState(taskRuleState))).toBe("- [ ] \n");
});

test("creates unordered, ordered, and task lists from lightweight markdown triggers", () => {
  let unorderedState = createEditorState(parseMarkdown("x\n"));
  const unorderedContainer = unorderedState.documentEditor.regions[0];

  if (!unorderedContainer) {
    throw new Error("Expected empty paragraph container");
  }

  unorderedState = setSelection(unorderedState, {
    anchor: {
      regionId: unorderedContainer.id,
      offset: 0,
    },
    focus: {
      regionId: unorderedContainer.id,
      offset: unorderedContainer.text.length,
    },
  });
  unorderedState = applyTextInputRule(unorderedState, "-") ?? unorderedState;
  unorderedState = applyTextInputRule(unorderedState, " ") ?? unorderedState;

  expect(serializeMarkdown(createDocumentFromEditorState(unorderedState))).toBe("-\n");
  expect(
    unorderedState.documentEditor.regions.some(
      (container) => container.id === unorderedState.selection.focus.regionId,
    ),
  ).toBe(true);

  let orderedState = createEditorState(parseMarkdown("x\n"));
  const orderedContainer = orderedState.documentEditor.regions[0];

  if (!orderedContainer) {
    throw new Error("Expected empty paragraph container");
  }

  orderedState = setSelection(orderedState, {
    anchor: {
      regionId: orderedContainer.id,
      offset: 0,
    },
    focus: {
      regionId: orderedContainer.id,
      offset: orderedContainer.text.length,
    },
  });
  orderedState = applyTextInputRule(orderedState, "1") ?? orderedState;
  orderedState = applyTextInputRule(orderedState, ".") ?? orderedState;
  orderedState = applyTextInputRule(orderedState, " ") ?? orderedState;

  expect(serializeMarkdown(createDocumentFromEditorState(orderedState))).toBe("1.\n");
  expect(
    orderedState.documentEditor.regions.some(
      (container) => container.id === orderedState.selection.focus.regionId,
    ),
  ).toBe(true);

  let taskState = createEditorState(parseMarkdown("x\n"));
  const taskContainer = taskState.documentEditor.regions[0];

  if (!taskContainer) {
    throw new Error("Expected empty paragraph container");
  }

  taskState = setSelection(taskState, {
    anchor: {
      regionId: taskContainer.id,
      offset: 0,
    },
    focus: {
      regionId: taskContainer.id,
      offset: taskContainer.text.length,
    },
  });
  taskState = applyTextInputRule(taskState, "- [ ] ") ?? taskState;

  expect(serializeMarkdown(createDocumentFromEditorState(taskState))).toBe("- [ ] \n");
  expect(
    taskState.documentEditor.regions.some(
      (container) => container.id === taskState.selection.focus.regionId,
    ),
  ).toBe(true);
});

test("merges or removes list items when backspacing at the start", () => {
  let listState = createEditorState(parseMarkdown("- one\n- two\n"));
  const two = listState.documentEditor.regions.find((container) => container.text === "two");

  if (!two) {
    throw new Error("Expected second list item");
  }

  listState = setSelection(listState, {
    regionId: two.id,
    offset: 0,
  });
  listState = handleStructuralBackspace(listState) ?? listState;

  expect(serializeMarkdown(createDocumentFromEditorState(listState))).toBe("- onetwo\n");

  let blankListState = createEditorState(parseMarkdown("- one\n-\n- two\n"));
  const emptyItem = blankListState.documentEditor.regions.find((container) => container.text === "");

  if (!emptyItem) {
    throw new Error("Expected blank list item");
  }

  blankListState = setSelection(blankListState, {
    regionId: emptyItem.id,
    offset: 0,
  });
  blankListState = handleStructuralBackspace(blankListState) ?? blankListState;

  expect(serializeMarkdown(createDocumentFromEditorState(blankListState))).toBe("- one\n- two\n");
});

test("preserves nested list semantics when splitting a nested task item at the end", () => {
  let state = createEditorState(parseMarkdown("- alpha\n  - [x] shipped child\n  - gamma\n"));
  const task = state.documentEditor.regions.find((container) => container.text === "shipped child");

  if (!task) {
    throw new Error("Expected nested task container");
  }

  state = setSelection(state, {
    regionId: task.id,
    offset: task.text.length,
  });
  state = dispatchKey(state, "insertLineBreak") ?? state;

  expect(serializeMarkdown(createDocumentFromEditorState(state))).toBe(
    "- alpha\n  - [x] shipped child\n  - [ ] \n  - gamma\n",
  );

  state = applyTextInputRule(state, "z") ?? state;

  expect(serializeMarkdown(createDocumentFromEditorState(state))).toBe(
    "- alpha\n  - [x] shipped child\n  - [ ] z\n  - gamma\n",
  );
});

test("toggles semantic task-list state for rendered task items", () => {
  const state = createEditorState(parseMarkdown("- [ ] ship it\n"));
  const list = state.documentEditor.document.blocks[0];

  if (!list || list.type !== "list") {
    throw new Error("Expected list block");
  }

  const listItem = list.children[0];

  if (!listItem) {
    throw new Error("Expected task list item");
  }

  const toggled = toggleTaskItem(state, listItem.id);

  if (!toggled) {
    throw new Error("Expected toggled task state");
  }

  expect(serializeMarkdown(createDocumentFromEditorState(toggled))).toBe("- [x] ship it\n");
});

test("toggles nested semantic task-list state for rendered task items", () => {
  const state = createEditorState(parseMarkdown("- parent\n  - [ ] ship nested\n"));
  const rootList = state.documentEditor.document.blocks[0];

  if (!rootList || rootList.type !== "list") {
    throw new Error("Expected root list block");
  }

  const parentItem = rootList.children[0];
  const nestedList = parentItem?.children.find((child) => child.type === "list");

  if (!nestedList || nestedList.type !== "list") {
    throw new Error("Expected nested list block");
  }

  const nestedItem = nestedList.children[0];

  if (!nestedItem) {
    throw new Error("Expected nested task list item");
  }

  const toggled = toggleTaskItem(state, nestedItem.id);

  if (!toggled) {
    throw new Error("Expected toggled nested task state");
  }

  expect(serializeMarkdown(createDocumentFromEditorState(toggled))).toBe("- parent\n  - [x] ship nested\n");
});
