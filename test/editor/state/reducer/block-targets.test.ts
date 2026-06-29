import { describe, expect, test } from "bun:test";
import {
  createListItemBlock,
  createParagraphTextBlock,
  rebuildListBlock,
  type ListBlock,
} from "@/document";
import { readEditorEffects, resolveRegion } from "@/editor/state";
import { effect } from "@/editor/state/effects";
import { dispatch } from "@/editor/state/reducer/state";
import { resolveSelectionTarget, target } from "@/editor/state/selection";
import { getRegion, setup } from "../../helpers";
import type { EditorState } from "@/editor/state";

// Block-reference targets: actions address "the block I just built" by
// reference into their own action payload; dispatch materializes those
// references into positional targets before the edit applies.

describe("Block-reference targets", () => {
  test("materializes a block selection target against a replace-block payload", () => {
    const state = setup("- alpha\n- beta\n");
    const list = getListBlock(state);
    const listPath = getListPath(state);
    const insertedItem = createListItem("gamma");

    const next = dispatch(state, {
      kind: "replace-block",
      block: rebuildListBlock(list, [...list.items, insertedItem]),
      blockPath: listPath,
      selection: target.block(insertedItem, "end"),
    });

    const focusRegion = resolveRegion(next.documentIndex, next.selection.focus.regionPath);

    expect(focusRegion?.text).toBe("gamma");
    expect(next.selection.focus.offset).toBe("gamma".length);
  });

  test("materializes a block selection target against a splice-blocks payload", () => {
    const state = setup("alpha\n");
    const insertedParagraph = createParagraphTextBlock("beta");

    const next = dispatch(state, {
      kind: "splice-blocks",
      blocks: [createParagraphTextBlock("intro"), insertedParagraph],
      count: 1,
      rootIndex: 0,
      selection: target.block(insertedParagraph),
    });

    expect(next.selection.focus.regionPath).toBe(getRegion(next, "beta").path);
    expect(next.selection.focus.offset).toBe(0);
  });

  test("materializes block-referenced inserted-item effects into block paths", () => {
    const state = setup("- alpha\n");
    const list = getListBlock(state);
    const listPath = getListPath(state);
    const insertedItem = createListItem("beta");

    const next = dispatch(state, {
      kind: "replace-block",
      block: rebuildListBlock(list, [...list.items, insertedItem]),
      blockPath: listPath,
      effect: effect.listItemInserted(insertedItem),
      selection: target.block(insertedItem),
    });

    expect(readEditorEffects(next)).toContainEqual({
      blockPath: "root.0.children.1",
      kind: "list-item-inserted",
    });
  });

  test("targets blocks nested below the replaced block through the payload base path", () => {
    const state = setup("> - alpha\n");
    const list = getListBlock(state);
    const listPath = getListPath(state);
    const insertedItem = createListItem("beta");

    const next = dispatch(state, {
      kind: "replace-block",
      block: rebuildListBlock(list, [...list.items, insertedItem]),
      blockPath: listPath,
      selection: target.block(insertedItem),
    });

    expect(next.selection.focus.regionPath).toBe(getRegion(next, "beta").path);
  });

  test("throws when the referenced block is not in the action payload", () => {
    const state = setup("- alpha\n");
    const list = getListBlock(state);
    const listPath = getListPath(state);

    expect(() =>
      dispatch(state, {
        kind: "replace-block",
        block: rebuildListBlock(list, list.items),
        blockPath: listPath,
        selection: target.block(createParagraphTextBlock("elsewhere")),
      }),
    ).toThrow("not present in the action's block payload");
  });

  test("throws when a block-referenced effect has no action payload", () => {
    const state = setup("- alpha\n");
    const list = getListBlock(state);

    expect(() =>
      dispatch(state, {
        effect: effect.listItemInserted(list.items[0]!),
        kind: "keep-state",
      }),
    ).toThrow("require a block payload action");
  });
});

describe("Block-path targets", () => {
  test("resolves a root block path to the root primary region", () => {
    const state = setup("alpha\n\n- beta\n");
    const selection = resolveSelectionTarget(
      state.documentIndex,
      target.blockPath("root.0", "end"),
    );

    expect(selection?.focus).toEqual({
      offset: "alpha".length,
      regionPath: getRegion(state, "alpha").path,
    });
  });

  test("resolves a nested block path to the descendant primary region", () => {
    const state = setup("alpha\n\n- beta\n");
    const selection = resolveSelectionTarget(
      state.documentIndex,
      target.blockPath("root.1.children.0", "end"),
    );

    expect(selection?.focus).toEqual({
      offset: "beta".length,
      regionPath: getRegion(state, "beta").path,
    });
  });

  test("rejects invalid block paths", () => {
    expect(() => target.blockPath("root.0.rows.0.cells.0")).toThrow(
      "Invalid block path selection target",
    );
  });
});

function getListBlock(state: EditorState): ListBlock {
  const indexedList = state.documentIndex.blocks.find(
    (indexedBlock) => indexedBlock.block.type === "list",
  );

  if (!indexedList || indexedList.block.type !== "list") {
    throw new Error("Expected a list block");
  }

  return indexedList.block;
}

function getListPath(state: EditorState): string {
  const indexedList = state.documentIndex.blocks.find(
    (indexedBlock) => indexedBlock.block.type === "list",
  );

  if (!indexedList) {
    throw new Error("Expected a list block");
  }

  return indexedList.path;
}

function createListItem(text: string) {
  return createListItemBlock({
    checked: null,
    children: [createParagraphTextBlock(text)],
    compact: true,
  });
}
