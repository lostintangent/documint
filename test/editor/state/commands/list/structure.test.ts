import { indexedTextEntries } from "@test/editor/helpers";
import { describe, expect, test } from "bun:test";
import {
  deleteBackward,
  deleteForward,
  insertLineBreak,
  insertText,
  moveListItemDown,
  moveListItemUp,
  readEditorEffects,
  resolveIndexedBlock,
  toggleTask,
} from "@/editor/state";
import { redoEditorState, setSelection, undoEditorState } from "@/editor/state";
import { getPath, placeAt, selectIn, setup, toMarkdown } from "../../../helpers";

describe("List structure", () => {
  test("supports canvas list splits with undo and redo", () => {
    let state = setup("- alpha\n- beta\n");
    const target = getPath(state, "beta");

    state = placeAt(state, target, 2);

    const splitState = insertLineBreak(state);

    if (!splitState) {
      throw new Error("Expected split state");
    }

    state = splitState;

    expect(toMarkdown(state)).toBe("- alpha\n- be\n- ta\n");

    state = undoEditorState(state);
    expect(toMarkdown(state)).toBe("- alpha\n- beta\n");

    state = redoEditorState(state);
    expect(toMarkdown(state)).toBe("- alpha\n- be\n- ta\n");
  });

  test("preserves nested children when splitting a list item mid-text", () => {
    let state = setup("- alpha\n  - child\n- beta\n");
    const alpha = getPath(state, "alpha");

    state = placeAt(state, alpha, 2);
    state = insertLineBreak(state) ?? state;

    expect(toMarkdown(state)).toBe("- al\n  - child\n- pha\n- beta\n");
  });

  test("reports a list item inserted effect when Enter splits a regular list item", () => {
    let state = setup("- alpha\n");
    const target = indexedTextEntries(state)[0];

    if (!target) {
      throw new Error("Expected list item container");
    }

    state = placeAt(state, target, target.text.length);

    const result = insertLineBreak(state);

    expect(result).not.toBeNull();
    expect(readEditorEffects(result!).some((effect) => effect.kind === "list-item-inserted")).toBe(
      true,
    );
  });

  test("reports a list item inserted effect when Enter splits a task list item", () => {
    let state = setup("- [ ] alpha\n");
    const target = indexedTextEntries(state)[0];

    if (!target) {
      throw new Error("Expected task list item container");
    }

    state = placeAt(state, target, target.text.length);

    const result = insertLineBreak(state);

    expect(result).not.toBeNull();
    expect(readEditorEffects(result!).some((effect) => effect.kind === "list-item-inserted")).toBe(
      true,
    );
  });

  test("moves top-level list items up and down while preserving their nested subtree", () => {
    let state = setup("- alpha\n  - child\n- beta\n- gamma\n");
    const alpha = getPath(state, "alpha");

    state = placeAt(state, alpha, 0);
    state = moveListItemDown(state) ?? state;

    expect(toMarkdown(state)).toBe("- beta\n- alpha\n  - child\n- gamma\n");

    state = moveListItemUp(state) ?? state;

    expect(toMarkdown(state)).toBe("- alpha\n  - child\n- beta\n- gamma\n");
  });

  test("moves nested list items only within their current parent list", () => {
    let state = setup("- parent\n  - first\n  - second\n  - third\n");
    const second = getPath(state, "second");

    state = placeAt(state, second, 0);
    state = moveListItemUp(state) ?? state;

    expect(toMarkdown(state)).toBe("- parent\n  - second\n  - first\n  - third\n");

    state = moveListItemDown(state) ?? state;

    expect(toMarkdown(state)).toBe("- parent\n  - first\n  - second\n  - third\n");
  });

  test("does not move list items past the boundaries of their current parent list", () => {
    let state = setup("- alpha\n- beta\n");
    const alpha = indexedTextEntries(state).find((container) => container.text === "alpha");
    const beta = indexedTextEntries(state).find((container) => container.text === "beta");

    if (!alpha || !beta) {
      throw new Error("Expected top-level list paths");
    }

    state = placeAt(state, alpha, 0);

    expect(moveListItemUp(state)).toBeNull();

    state = placeAt(state, beta, 0);

    expect(moveListItemDown(state)).toBeNull();
  });

  test("routes list item move commands through the editor command layer", () => {
    let state = setup("- alpha\n- beta\n");
    const beta = getPath(state, "beta");

    state = placeAt(state, beta, 0);
    state = moveListItemUp(state) ?? state;

    expect(toMarkdown(state)).toBe("- beta\n- alpha\n");
  });

  test("inserts new list items above or below at list boundaries", () => {
    let state = setup("- alpha\n- beta\n");
    const alpha = getPath(state, "alpha");

    state = placeAt(state, alpha, 0);
    state = insertLineBreak(state) ?? state;

    expect(toMarkdown(state)).toBe("-\n- alpha\n- beta\n");

    const beta = getPath(state, "beta");

    state = placeAt(state, beta, beta.text.length);
    state = insertLineBreak(state) ?? state;

    expect(toMarkdown(state)).toBe("-\n- alpha\n- beta\n-\n");
  });

  test("pressing enter on an empty list item exits it as a paragraph", () => {
    let state = setup("- alpha\n- beta\n");
    const target = getPath(state, "beta");

    state = placeAt(state, target, 0);
    state = insertLineBreak(state) ?? state;

    const empty = indexedTextEntries(state).find((container) => container.text === "");

    if (!empty) {
      throw new Error("Expected empty item");
    }

    state = placeAt(state, empty, 0);
    state = insertLineBreak(state) ?? state;

    expect(toMarkdown(state)).toBe("- alpha\n\n\n\n- beta\n");
  });

  test("rejoins adjacent compatible lists when deleting the empty paragraph between them", () => {
    let state = setup("- alpha\n- beta\n");
    const beta = getPath(state, "beta");

    state = placeAt(state, beta, 0);
    state = insertLineBreak(state) ?? state;

    const emptyItem = indexedTextEntries(state).find((container) => container.text === "");

    if (!emptyItem) {
      throw new Error("Expected empty list item");
    }

    state = placeAt(state, emptyItem, 0);
    state = insertLineBreak(state) ?? state;

    const paragraph = indexedTextEntries(state).find((container) => container.text === "");

    if (!paragraph) {
      throw new Error("Expected empty paragraph between lists");
    }

    state = placeAt(state, paragraph, 0);
    state = deleteBackward(state) ?? state;

    expect(toMarkdown(state)).toBe("- alpha\n- beta\n");
  });

  test("joining adjacent lists across an empty paragraph lands the cursor at the deepest-last path of the previous list", () => {
    // Regression: the override used to hardcode the cursor at
    // [last-top-level-item, leading-child], which is correct only when
    // the last top-level item has no nested children. With nested
    // children, the actual previous in-flow editor path is deeper. The
    // override uses the shared flow query to land at the same
    // spot the universal in-flow rule would.
    let state = setup("- top\n  - nested\n\nstub\n\n- another\n");

    const stub = getPath(state, "stub");

    // Empty out 'stub' to leave a bare empty paragraph between the two lists.
    state = selectIn(state, stub, 0, stub.text.length);
    state = insertText(state, "") ?? state;

    const empty = indexedTextEntries(state).find(
      (r) => r.block.type === "paragraph" && r.text === "",
    );
    if (!empty) throw new Error("Expected empty paragraph between lists");

    state = placeAt(state, empty, 0);
    state = deleteBackward(state) ?? state;

    // Two lists merged into one.
    expect(toMarkdown(state)).toBe("- top\n  - nested\n- another\n");

    // Cursor at end of "nested" — the deepest-last path of the
    // pre-merge previous list — not at end of "top" (the last top-level
    // item's leading paragraph, which the old hardcoded path produced).
    const nested = getPath(state, "nested");

    expect(state.selection.focus.path).toBe(nested.path);
    expect(state.selection.focus.offset).toBe("nested".length);
  });

  test("forward delete removes an empty list item and moves the caret to the next list item", () => {
    let state = setup("- alpha\n-\n- beta\n");
    const emptyItem = indexedTextEntries(state).find((container) => container.text === "");

    if (!emptyItem) {
      throw new Error("Expected empty list item");
    }

    state = placeAt(state, emptyItem, 0);
    state = deleteForward(state) ?? state;

    const beta = getPath(state, "beta");

    expect(toMarkdown(state)).toBe("- alpha\n- beta\n");
    expect(state.selection.focus.path).toBe(beta.path);
    expect(state.selection.focus.offset).toBe(0);
  });

  test("forward delete removes a trailing empty list item and moves the caret to the next root block", () => {
    let state = setup("- alpha\n-\n\nafter\n");
    const emptyItem = indexedTextEntries(state).find((container) => container.text === "");

    if (!emptyItem) {
      throw new Error("Expected empty list item");
    }

    state = placeAt(state, emptyItem, 0);
    state = deleteForward(state) ?? state;

    const after = getPath(state, "after");

    expect(toMarkdown(state)).toBe("- alpha\n\nafter\n");
    expect(state.selection.focus.path).toBe(after.path);
    expect(state.selection.focus.offset).toBe(0);
  });

  test("lifts empty nested list items one level before exiting the list entirely", () => {
    let state = setup("- parent\n  - child\n  - \n- sibling\n");
    const empty = indexedTextEntries(state).find((container) => {
      if (container.text !== "") {
        return false;
      }

      const block = resolveIndexedBlock(state.documentIndex, container.blockPath);
      const item = block?.parentBlockPath
        ? resolveIndexedBlock(state.documentIndex, block.parentBlockPath)
        : null;
      const list = item?.parentBlockPath
        ? resolveIndexedBlock(state.documentIndex, item.parentBlockPath)
        : null;

      return (
        block?.block.type === "paragraph" &&
        item?.block.type === "listItem" &&
        list?.block.type === "list" &&
        list.parentBlockPath !== null
      );
    });

    if (!empty) {
      throw new Error("Expected empty nested list item");
    }

    state = placeAt(state, empty, 0);
    state = insertLineBreak(state) ?? state;

    expect(toMarkdown(state)).toBe("- parent\n  - child\n-\n- sibling\n");
  });

  test("routes list enter behavior and markdown task rules", () => {
    let state = setup("- [x] shipped baseline\n");
    const task = getPath(state, "shipped baseline");

    state = placeAt(state, task, "shipped b".length);
    state = insertLineBreak(state) ?? state;

    expect(toMarkdown(state)).toBe("- [x] shipped b\n- [ ] aseline\n");

    let inputState = setup("x\n");
    const placeholder = indexedTextEntries(inputState)[0];

    if (!placeholder) {
      throw new Error("Expected placeholder container");
    }

    inputState = setSelection(inputState, {
      anchor: {
        path: placeholder.path,
        offset: 0,
      },
      focus: {
        path: placeholder.path,
        offset: placeholder.text.length,
      },
    });

    const taskRuleState = insertText(inputState, "[ ] ");

    if (!taskRuleState || "documentIndex" in taskRuleState === false) {
      throw new Error("Expected canvas state from task rule");
    }

    expect(toMarkdown(taskRuleState)).toBe("- [ ] \n");

    let canonicalInputState = setup("x\n");
    const canonicalPlaceholder = indexedTextEntries(canonicalInputState)[0];

    if (!canonicalPlaceholder) {
      throw new Error("Expected placeholder container");
    }

    canonicalInputState = setSelection(canonicalInputState, {
      anchor: {
        path: canonicalPlaceholder.path,
        offset: 0,
      },
      focus: {
        path: canonicalPlaceholder.path,
        offset: canonicalPlaceholder.text.length,
      },
    });

    const canonicalTaskRuleState = insertText(canonicalInputState, "- [ ] ");

    if (!canonicalTaskRuleState || "documentIndex" in canonicalTaskRuleState === false) {
      throw new Error("Expected canvas state from canonical task rule");
    }

    expect(toMarkdown(canonicalTaskRuleState)).toBe("- [ ] \n");
  });

  test("creates unordered, ordered, and task lists from lightweight markdown triggers", () => {
    let unorderedState = setup("x\n");
    const unorderedContainer = indexedTextEntries(unorderedState)[0];

    if (!unorderedContainer) {
      throw new Error("Expected empty paragraph container");
    }

    unorderedState = setSelection(unorderedState, {
      anchor: {
        path: unorderedContainer.path,
        offset: 0,
      },
      focus: {
        path: unorderedContainer.path,
        offset: unorderedContainer.text.length,
      },
    });
    unorderedState = insertText(unorderedState, "-") ?? unorderedState;
    unorderedState = insertText(unorderedState, " ") ?? unorderedState;

    expect(toMarkdown(unorderedState)).toBe("-\n");
    expect(
      indexedTextEntries(unorderedState).some(
        (container) => container.path === unorderedState.selection.focus.path,
      ),
    ).toBe(true);

    let orderedState = setup("x\n");
    const orderedContainer = indexedTextEntries(orderedState)[0];

    if (!orderedContainer) {
      throw new Error("Expected empty paragraph container");
    }

    orderedState = setSelection(orderedState, {
      anchor: {
        path: orderedContainer.path,
        offset: 0,
      },
      focus: {
        path: orderedContainer.path,
        offset: orderedContainer.text.length,
      },
    });
    orderedState = insertText(orderedState, "1") ?? orderedState;
    orderedState = insertText(orderedState, ".") ?? orderedState;
    orderedState = insertText(orderedState, " ") ?? orderedState;

    expect(toMarkdown(orderedState)).toBe("1.\n");
    expect(
      indexedTextEntries(orderedState).some(
        (container) => container.path === orderedState.selection.focus.path,
      ),
    ).toBe(true);

    let taskState = setup("x\n");
    const taskContainer = indexedTextEntries(taskState)[0];

    if (!taskContainer) {
      throw new Error("Expected empty paragraph container");
    }

    taskState = setSelection(taskState, {
      anchor: {
        path: taskContainer.path,
        offset: 0,
      },
      focus: {
        path: taskContainer.path,
        offset: taskContainer.text.length,
      },
    });
    taskState = insertText(taskState, "[") ?? taskState;
    taskState = insertText(taskState, " ") ?? taskState;
    taskState = insertText(taskState, "]") ?? taskState;
    taskState = insertText(taskState, " ") ?? taskState;

    expect(toMarkdown(taskState)).toBe("- [ ] \n");
    expect(
      indexedTextEntries(taskState).some(
        (container) => container.path === taskState.selection.focus.path,
      ),
    ).toBe(true);
  });

  test("merges or removes list items when backspacing at the start", () => {
    let listState = setup("- one\n- two\n");
    const two = getPath(listState, "two");

    listState = placeAt(listState, two, 0);
    listState = deleteBackward(listState) ?? listState;

    expect(toMarkdown(listState)).toBe("- onetwo\n");

    let blankListState = setup("- one\n-\n- two\n");
    const emptyItem = indexedTextEntries(blankListState).find((container) => container.text === "");

    if (!emptyItem) {
      throw new Error("Expected blank list item");
    }

    blankListState = placeAt(blankListState, emptyItem, 0);
    blankListState = deleteBackward(blankListState) ?? blankListState;

    expect(toMarkdown(blankListState)).toBe("- one\n- two\n");
  });

  test("preserves nested list semantics when splitting a nested task item at the end", () => {
    let state = setup("- alpha\n  - [x] shipped child\n  - gamma\n");
    const task = getPath(state, "shipped child");

    state = placeAt(state, task, task.text.length);
    state = insertLineBreak(state) ?? state;

    expect(toMarkdown(state)).toBe("- alpha\n  - [x] shipped child\n  - [ ] \n  - gamma\n");

    state = insertText(state, "z") ?? state;

    expect(toMarkdown(state)).toBe("- alpha\n  - [x] shipped child\n  - [ ] z\n  - gamma\n");
  });

  test("toggles semantic task-list state for rendered task items", () => {
    const state = setup("- [ ] ship it\n");
    const list = state.documentIndex.document.blocks[0];

    if (!list || list.type !== "list") {
      throw new Error("Expected list block");
    }

    const listItem = list.items[0];

    if (!listItem) {
      throw new Error("Expected task list item");
    }

    const listItemPath = state.documentIndex.blocks.find((entry) => entry.block === listItem)?.path;
    const toggled = listItemPath ? toggleTask(state, listItemPath) : null;

    if (!toggled) {
      throw new Error("Expected toggled task state");
    }

    expect(toMarkdown(toggled)).toBe("- [x] ship it\n");
  });

  test("preserves selection identity when toggling task-list state", () => {
    let state = setup("- [ ] task\n\ncursor\n");
    const cursor = getPath(state, "cursor");

    state = placeAt(state, cursor, "cursor".length);

    const taskItem = state.documentIndex.blocks.find((entry) => entry.block.type === "listItem");

    if (!taskItem) {
      throw new Error("Expected task list item");
    }

    const toggled = toggleTask(state, taskItem.path);

    if (!toggled) {
      throw new Error("Expected task toggle state");
    }

    expect(toMarkdown(toggled)).toBe("- [x] task\n\ncursor\n");
    expect(toggled.selection).toBe(state.selection);
  });

  test("toggles nested semantic task-list state for rendered task items", () => {
    const state = setup("- parent\n  - [ ] ship nested\n");
    const rootList = state.documentIndex.document.blocks[0];

    if (!rootList || rootList.type !== "list") {
      throw new Error("Expected root list block");
    }

    const parentItem = rootList.items[0];
    const nestedList = parentItem?.children.find((child) => child.type === "list");

    if (!nestedList || nestedList.type !== "list") {
      throw new Error("Expected nested list block");
    }

    const nestedItem = nestedList.items[0];

    if (!nestedItem) {
      throw new Error("Expected nested task list item");
    }

    const nestedItemPath = state.documentIndex.blocks.find(
      (entry) => entry.block === nestedItem,
    )?.path;
    const toggled = nestedItemPath ? toggleTask(state, nestedItemPath) : null;

    if (!toggled) {
      throw new Error("Expected toggled nested task state");
    }

    expect(toMarkdown(toggled)).toBe("- parent\n  - [x] ship nested\n");
  });

  test("toggles task list state through the action dispatcher", () => {
    const state = setup("- [ ] task\n");
    const taskItem = state.documentIndex.blocks.find((entry) => entry.block.type === "listItem");

    if (!taskItem) {
      throw new Error("Expected task list item");
    }

    const nextState = toggleTask(state, taskItem.path);

    if (!nextState) {
      throw new Error("Expected task toggle state");
    }

    expect(toMarkdown(nextState)).toBe("- [x] task\n");
  });

  test("places the cursor at the merge junction when backspacing a non-empty list item", () => {
    let state = setup("- one\n- two\n");
    const two = getPath(state, "two");

    state = placeAt(state, two, 0);
    state = deleteBackward(state) ?? state;

    const merged = getPath(state, "onetwo");

    expect(state.selection.focus.path).toBe(merged.path);
    expect(state.selection.focus.offset).toBe("one".length);
  });

  test("places the cursor at the merge junction when backspacing past the first item in a list", () => {
    // Regression: the merge-cursor target used to identify the rebuilt block
    // through a runtime handle instead of the absorber reference, so the walk's
    // first match was the outer container and root-primary-path targeting
    // cascaded to the first leaf — the *first* item, not the merge seam in
    // items[1]. The target is now based on the absorber reference, so the cursor
    // lands at the seam regardless of how deep into the list we are.
    let state = setup("- one\n- two\n- three\n");
    const three = getPath(state, "three");

    state = placeAt(state, three, 0);
    state = deleteBackward(state) ?? state;

    const merged = getPath(state, "twothree");

    expect(toMarkdown(state)).toBe("- one\n- twothree\n");
    expect(state.selection.focus.path).toBe(merged.path);
    expect(state.selection.focus.offset).toBe("two".length);
  });

  test("places the cursor at the merge junction when backspacing past the first item in a nested list", () => {
    // Same regression as the top-level case, exercised against a deeper
    // tree to confirm the path-based target traverses arbitrary
    // ancestor structure. Target was previously cascading to "alpha"
    // (the first leaf of the rebuilt root list), not the seam in
    // "onetwo" inside the nested list.
    let state = setup("- alpha\n  - one\n  - two\n");
    const two = getPath(state, "two");

    state = placeAt(state, two, 0);
    state = deleteBackward(state) ?? state;

    const merged = getPath(state, "onetwo");

    expect(toMarkdown(state)).toBe("- alpha\n  - onetwo\n");
    expect(state.selection.focus.path).toBe(merged.path);
    expect(state.selection.focus.offset).toBe("one".length);
  });

  test("backspacing an empty first nested list item removes just the item and lands at the parent's leading paragraph", () => {
    // Reported bug: empty first nested list item used to nuke the whole
    // top-level list (because the old code spliced rootIndex blindly).
    // The universal rule routes through structural removal: drop the
    // empty nested item from its containing list (collapsing the empty
    // nested list into the parent item if it was the sole item), and
    // land the cursor at the previous-in-flow path — which is the
    // parent's leading paragraph.
    let state = setup("- top\n  - \n  - sibling\n");
    const empty = indexedTextEntries(state).find(
      (r) => r.block.type === "paragraph" && r.text === "",
    );

    if (!empty) throw new Error("Expected empty nested item");

    state = placeAt(state, empty, 0);
    state = deleteBackward(state) ?? state;

    const top = getPath(state, "top");

    expect(toMarkdown(state)).toBe("- top\n  - sibling\n");
    expect(state.selection.focus.path).toBe(top.path);
    expect(state.selection.focus.offset).toBe("top".length);
  });

  test("backspacing an empty deeply-nested first list item collapses one level at a time", () => {
    // "Regardless of depth" — the structural removal walks down to the
    // smallest containing list whose removal handles the deletion.
    let state = setup("- one\n  - two\n    - \n");
    const empty = indexedTextEntries(state).find(
      (r) => r.block.type === "paragraph" && r.text === "",
    );

    if (!empty) throw new Error("Expected empty doubly-nested item");

    state = placeAt(state, empty, 0);
    state = deleteBackward(state) ?? state;

    expect(toMarkdown(state)).toBe("- one\n  - two\n");
    const two = indexedTextEntries(state).find((r) => r.text === "two");
    expect(state.selection.focus.path).toBe(two!.path);
    expect(state.selection.focus.offset).toBe("two".length);
  });

  test("backspace at start of a non-empty nested first list item merges into the previous in-flow path", () => {
    // Only top-level first items get the paragraph-demotion override.
    // Nested first items fall through to the universal boundary rule, so
    // their text merges into the parent item's leading paragraph and the
    // item itself collapses in place.
    let state = setup("- alpha\n  - bravo\n  - charlie\n");
    const bravo = getPath(state, "bravo");

    state = placeAt(state, bravo, 0);
    state = deleteBackward(state) ?? state;

    expect(toMarkdown(state)).toBe("- alphabravo\n  - charlie\n");
  });

  test("backspacing an empty list item lands the cursor at the visually previous path, not the previous sibling", () => {
    // - alpha
    //   - bravo   ← visually previous to the empty third item
    // - (empty)   ← backspace here
    //
    // The previous *sibling* in alpha's parent list is alpha itself, but the
    // previous editable position in document order is the end of bravo. The
    // cursor should land where left-arrow would.
    let state = setup("- alpha\n  - bravo\n- charlie\n");
    const charlie = getPath(state, "charlie");

    // Empty out charlie so the structural-empty-removal branch fires.
    state = placeAt(state, charlie, 0);
    for (let i = 0; i < "charlie".length; i++) {
      state = deleteForward(state) ?? state;
    }

    const empty = indexedTextEntries(state).find((r) => r.text === "");

    if (!empty) throw new Error("Expected empty third item");

    state = placeAt(state, empty, 0);
    state = deleteBackward(state) ?? state;

    const bravo = getPath(state, "bravo");

    expect(state.selection.focus.path).toBe(bravo.path);
    expect(state.selection.focus.offset).toBe("bravo".length);
  });
});
