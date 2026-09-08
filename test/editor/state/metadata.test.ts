import { describe, expect, test } from "bun:test";
import {
  deleteBackward,
  deleteSelection,
  insertLineBreak,
  insertText,
  pasteFragment,
  readEditorEffects,
  redo,
  replaceSelection,
  replaceTextRange,
  selectAll,
  setSelection,
  toggleMetadataBoolean,
  undo,
  type EditorState,
} from "@/editor/state";
import { getMetadataEntry, getPath, setup, toMarkdown } from "../helpers";

const metadataFixture = `---
title: Draft
slug: first
---
Body
`;

describe("Metadata text editing", () => {
  test("edits keys and values through typing and explicit range replacement", () => {
    const initial = setup(metadataFixture);
    const slugKey = requireTextMetadataEntry(initial, 1, "key");
    const selectedKey = selectMetadataText(initial, slugKey, slugKey.content.length);
    const renamed = requireState(insertText(selectedKey, "-id"));

    expect([...structuredMetadata(renamed)]).toEqual([
      ["title", "Draft"],
      ["slug-id", "first"],
    ]);
    expect(renamed.documentIndex.blocks).toBe(selectedKey.documentIndex.blocks);
    expect(readEditorEffects(renamed)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          contentKind: "metadata",
          kind: "text-inserted",
          path: slugKey.path,
          text: "-id",
        }),
      ]),
    );

    const titleValue = requireTextMetadataEntry(renamed, 0, "value");
    const selectedValue = selectMetadataText(renamed, titleValue, 2);
    const replaced = requireState(
      replaceTextRange(selectedValue, 0, titleValue.content.length, "Final"),
    );

    expect([...structuredMetadata(replaced)]).toEqual([
      ["title", "Final"],
      ["slug-id", "first"],
    ]);
    expect(replaced.selection.focus).toEqual({ path: titleValue.path, offset: "Final".length });
  });

  test("pastes plain text into one value and rejects structural or cross-field paste", () => {
    const initial = setup(metadataFixture);
    const titleValue = requireTextMetadataEntry(initial, 0, "value");
    const selectedValue = selectMetadataText(initial, titleValue, titleValue.content.length);
    const pastedValue = requireState(
      pasteFragment(selectedValue, { kind: "text", text: " notes" }),
    );

    expect(structuredMetadata(pastedValue).get("title")).toBe("Draft notes");

    const slugKey = requireTextMetadataEntry(pastedValue, 1, "key");
    const crossFieldSelection = setSelection(pastedValue, {
      anchor: { path: titleValue.path, offset: 1 },
      focus: { path: slugKey.path, offset: 1 },
    });
    expect(pasteFragment(crossFieldSelection, { kind: "text", text: "x" })).toBeNull();
  });

  test("deletes characters without merging metadata fields", () => {
    const initial = setup(metadataFixture);
    const titleValue = requireTextMetadataEntry(initial, 0, "value");
    const backward = requireState(
      deleteBackward(selectMetadataText(initial, titleValue, titleValue.content.length)),
    );

    expect(structuredMetadata(backward).get("title")).toBe("Draf");
    expect(readEditorEffects(backward)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          contentKind: "metadata",
          direction: "backward",
          kind: "text-deleted",
          path: titleValue.path,
          text: "t",
        }),
      ]),
    );

    const slugKey = requireTextMetadataEntry(initial, 1, "key");
    const crossFieldSelection = setSelection(initial, {
      anchor: { path: titleValue.path, offset: 1 },
      focus: { path: slugKey.path, offset: 1 },
    });
    expect(deleteSelection(crossFieldSelection)).toBe(crossFieldSelection);
  });

  test("inserts line breaks in string values and rejects Enter on keys", () => {
    const initial = setup(metadataFixture);
    const titleValue = requireTextMetadataEntry(initial, 0, "value");
    const selectedValue = selectMetadataText(initial, titleValue, titleValue.content.length);
    const withLineBreak = requireState(insertLineBreak(selectedValue));

    expect(structuredMetadata(withLineBreak).get("title")).toBe("Draft\n");
    expect(toMarkdown(withLineBreak)).toContain("title: |\n  Draft");
    expect(replaceSelection(selectedValue, "one\rtwo")).toBe(selectedValue);

    const slugKey = requireTextMetadataEntry(initial, 1, "key");
    const selectedKey = selectMetadataText(initial, slugKey, 2);

    expect(insertLineBreak(selectedKey)).toBeNull();
  });

  test("keeps Select All inside the focused metadata text", () => {
    const initial = setup(metadataFixture);
    const titleValue = requireTextMetadataEntry(initial, 0, "value");
    const selected = selectMetadataText(initial, titleValue, 2);
    const all = selectAll(selected);

    expect(all.selection).toEqual({
      anchor: { path: titleValue.path, offset: 0 },
      focus: { path: titleValue.path, offset: titleValue.content.length },
    });
    expect(deleteSelection(all)?.documentIndex.document.blocks).toBe(
      initial.documentIndex.document.blocks,
    );
  });

  test("rejects key newlines and colliding renames", () => {
    const initial = setup(metadataFixture);
    const slugKey = requireTextMetadataEntry(initial, 1, "key");
    const selectedKey = setSelection(initial, {
      anchor: { path: slugKey.path, offset: 0 },
      focus: { path: slugKey.path, offset: slugKey.content.length },
    });

    for (const replacement of ["title", "new\nkey", "new\rkey"]) {
      expect(replaceSelection(selectedKey, replacement)).toBe(selectedKey);
    }
  });

  test("undoes and redoes metadata text without rebuilding body indexes", () => {
    const initial = setup(metadataFixture);
    const title = requireTextMetadataEntry(initial, 0, "value");
    const edited = requireState(
      insertText(selectMetadataText(initial, title, title.content.length), "!"),
    );
    const undone = undo(edited);
    const redone = redo(undone);

    expect(structuredMetadata(undone).get("title")).toBe("Draft");
    expect(structuredMetadata(redone).get("title")).toBe("Draft!");
    expect(undone.documentIndex.blocks).toBe(edited.documentIndex.blocks);
  });
});

describe("Metadata booleans", () => {
  test("keeps edited boolean spellings as string values", () => {
    const initial = setup("---\nflag: pending\n---\nBody\n");
    const value = requireTextMetadataEntry(initial, 0, "value");
    const selected = selectMetadataText(initial, value, 0, value.content.length);
    const edited = replaceSelection(selected, "true");

    expect(structuredMetadata(edited).get("flag")).toBe("true");
    expect(edited.selection.focus).toEqual({ path: value.path, offset: 4 });
    expect(toMarkdown(edited)).toContain('flag: "true"');
  });

  test("toggles one boolean through normal history and rejects non-boolean paths", () => {
    const initial = setup(`---
title: Draft
draft: false
owner: docs
---
Body
`);
    const draft = getMetadataEntry(initial, 1, "boolean");
    const toggled = requireState(toggleMetadataBoolean(initial, draft.path));

    expect([...structuredMetadata(toggled)]).toEqual([
      ["title", "Draft"],
      ["draft", true],
      ["owner", "docs"],
    ]);
    expect(toggled.selection).toBe(initial.selection);

    const restored = undo(toggled);
    const redone = redo(restored);

    expect(structuredMetadata(restored).get("draft")).toBe(false);
    expect(structuredMetadata(redone).get("draft")).toBe(true);

    const titleKey = getMetadataEntry(initial, 0, "key");
    expect(toggleMetadataBoolean(initial, titleKey.path)).toBeNull();
    expect(toggleMetadataBoolean(initial, getPath(initial, "Body").path)).toBeNull();
  });
});

function requireTextMetadataEntry(state: EditorState, fieldIndex: number, type: "key" | "value") {
  const entry = getMetadataEntry(state, fieldIndex, type);

  if (!("text" in entry.record)) {
    throw new Error(`Expected string metadata field ${fieldIndex}`);
  }

  return {
    content: entry.record.text,
    path: entry.path,
  };
}

function selectMetadataText(
  state: EditorState,
  entry: ReturnType<typeof requireTextMetadataEntry>,
  anchorOffset: number,
  focusOffset = anchorOffset,
) {
  return setSelection(
    state,
    anchorOffset === focusOffset
      ? { path: entry.path, offset: anchorOffset }
      : {
          anchor: { path: entry.path, offset: anchorOffset },
          focus: { path: entry.path, offset: focusOffset },
        },
  );
}

function requireState(state: EditorState | null): EditorState {
  if (!state) {
    throw new Error("Expected metadata edit");
  }

  return state;
}

function structuredMetadata(state: EditorState) {
  const metadata = state.documentIndex.document.metadata;

  if (!metadata || "raw" in metadata) {
    throw new Error("Expected structured metadata");
  }

  return metadata;
}
