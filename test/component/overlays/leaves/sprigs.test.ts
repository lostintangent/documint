import { describe, expect, test } from "bun:test";
import { createStore } from "@/component/store";
import {
  cursorLeafSprig,
  pointerViewSprig,
  selectionLeafSprig,
} from "@/component/overlays/leaves/sprigs";
import { createLayoutCache, createEditorLayoutState, setSelection } from "@/editor";
import { addComment, deleteThread } from "@/editor/state";
import { getMetadataEntry, getPath, placeAt, setup } from "@test/editor/helpers";

describe("overlay leaf sprigs", () => {
  test("emits insertion leaves only when content editing is available", () => {
    const state = setup("");

    expect(readCursorLeaf(state, false)?.kind).toBe("insertion");
    expect(readCursorLeaf(state, true)).toBeNull();
  });

  test("emits table leaves only when content editing is available", () => {
    const state = setup("| Label |\n| --- |\n| Cell |\n");
    const selected = placeAt(state, getPath(state, "Cell"), 1);

    expect(readCursorLeaf(selected, false)?.kind).toBe("table");
    expect(readCursorLeaf(selected, true)).toBeNull();
  });

  test("anchors table leaves to the active cell's border box in every row", () => {
    const state = setup("| Name |\n| --- |\n| Ada |\n| Grace |\n\nAfter\n");

    for (const text of ["Name", "Ada", "Grace"]) {
      const store = createLaidOutStore(placeAt(state, getPath(state, text), 1));
      const { bottom, top } = store.layout
        .peekRendered()!
        .layout.pathBounds.get(getPath(state, text).path)!;

      // The leaf sits below the cell's bottom border or flips above its top.
      expect(readTableLeaf(store).extentOverride).toMatchObject({ bottom, top });
    }
  });

  test("extends the table leaf past every line of a cell that wraps", () => {
    const text = "A cell long enough to wrap in a narrow editor";
    const state = setup(`| Name |\n| --- |\n| ${text} |\n| Grace |\n`);
    const store = createLaidOutStore(placeAt(state, getPath(state, text), 1));
    const wide = readTableLeaf(store);

    store.layout.setLayoutResolver(() =>
      resolveTestLayout(store.editor.getState(), { width: 200 }),
    );
    store.layout.invalidate();
    store.layout.commit();
    const narrow = readTableLeaf(store);
    const lines = store.layout
      .peekRendered()!
      .layout.lines.filter((line) => line.path === getPath(state, text).path);

    expect(lines.length).toBeGreaterThan(1);
    expect(narrow.anchor).toEqual(wide.anchor);
    expect(narrow.extentOverride!.top).toBeLessThan(lines[0]!.top);
    expect(narrow.extentOverride!.bottom).toBeGreaterThan(lines.at(-1)!.top + lines.at(-1)!.height);
  });

  test("prefers cursor link leaves over table leaves", () => {
    const state = setup("| Label |\n| --- |\n| [Docs](https://example.com) |\n");
    const path = getPath(state, "Docs");
    const selected = placeAt(state, path, 1);

    expect(readCursorLeaf(selected, false)?.kind).toBe("link");
    expect(readCursorLeaf(selected, true)).toBeNull();
  });

  test("prefers cursor comment leaves over table leaves", () => {
    let state = setup("| Label |\n| --- |\n| Review target |\n");
    const path = getPath(state, "Review target");
    state =
      addComment(
        state,
        {
          endOffset: "Review".length,
          path: path.path,
          startOffset: 0,
        },
        "note",
      ) ?? state;
    state = placeAt(state, getPath(state, "Review target"), 2);

    expect(readCursorLeaf(state, false)?.kind).toBe("thread");
    expect(readCursorLeaf(state, true)).toBeNull();
  });

  test("keeps hover leaves available when read-only suppresses cursor leaves", () => {
    let state = setup("Review target\n");
    const path = getPath(state, "Review target").path;
    state =
      addComment(
        state,
        {
          endOffset: "Review".length,
          path,
          startOffset: 0,
        },
        "note",
      ) ?? state;
    state = placeAt(state, getPath(state, "Review target"), 2);
    const store = createLaidOutStore(state);

    expect(cursorLeafSprig.read(store, true)).toBeNull();
    expect(
      pointerViewSprig.read(store, {
        commentThreadIndex: 0,
        kind: "text",
      }).leaf?.kind,
    ).toBe("thread");
  });

  test("uses a pointer cursor without a leaf for the metadata header", () => {
    const state = setup(`---
title: Draft
---
Body
`);
    const store = createStore(state.documentIndex.document);

    expect(
      pointerViewSprig.read(store, {
        kind: "metadata-toggle",
      }),
    ).toEqual({
      cursor: "pointer",
      leaf: null,
    });
  });

  test("suppresses metadata annotation leaves even when selection handles exist", () => {
    const state = setup(`---
title: Draft
---
Body
`);
    const value = getMetadataEntry(state, 0, "value");
    const selected = setSelection(
      state,
      {
        anchor: { path: value.path, offset: 0 },
        focus: { path: value.path, offset: 5 },
      },
      false,
    );
    const store = createLaidOutStore(selected, {
      height: 240,
      metadataExpanded: true,
      width: 420,
    });

    expect(selectionLeafSprig.read(store, null)).toBeNull();
  });
});

describe("selection thread promotion", () => {
  test("shows the created thread where the selection toolbar was", () => {
    const { annotationLeaf, store } = createCommentFromSelection();
    const leaf = selectionLeafSprig.read(store, promoteSelection(store, annotationLeaf, 2));

    expect(leaf).toMatchObject({
      anchor: annotationLeaf.anchor,
      animateInitialComment: true,
      kind: "thread",
      leftOverride: annotationLeaf.leftOverride,
      paddingY: annotationLeaf.paddingY,
      thread: { comments: [{ body: "Third" }] },
      threadIndex: 2,
    });
  });

  test("keeps the created thread when an earlier thread is deleted", () => {
    const { annotationLeaf, store } = createCommentFromSelection();
    const promotion = promoteSelection(store, annotationLeaf, 2);

    store.editor.command(deleteThread, 1);

    expect(selectionLeafSprig.read(store, promotion)).toMatchObject({
      kind: "thread",
      thread: { comments: [{ body: "Third" }] },
      threadIndex: 1,
    });
  });

  test("falls back to the selection toolbar when the created thread is deleted", () => {
    const { annotationLeaf, store } = createCommentFromSelection();
    const promotion = promoteSelection(store, annotationLeaf, 2);

    store.editor.command(deleteThread, 2);

    expect(selectionLeafSprig.read(store, promotion)).toMatchObject({
      anchor: annotationLeaf.anchor,
      kind: "annotation",
      selection: annotationLeaf.selection,
    });
  });
});

// Two existing threads, then "Third" is selected and commented the way the
// annotation toolbar does it: the toolbar leaf is read before the comment is
// added, and the new thread is the last one.
function createCommentFromSelection() {
  let state = setup("First note\n\nSecond note\n\nThird note\n");

  for (const text of ["First", "Second"]) {
    const { path } = getPath(state, `${text} note`);
    state = addComment(state, { endOffset: text.length, path, startOffset: 0 }, text) ?? state;
  }

  const { path } = getPath(state, "Third note");
  const store = createLaidOutStore(
    setSelection(state, { anchor: { path, offset: 0 }, focus: { path, offset: 5 } }, false),
  );
  const annotationLeaf = selectionLeafSprig.read(store, null);

  if (annotationLeaf?.kind !== "annotation") {
    throw new Error("Expected an annotation leaf");
  }

  store.editor.command(addComment, annotationLeaf.selection, "Third");

  return { annotationLeaf, store };
}

// Mirrors `useSelection`'s `promoteLeafToThread`.
function promoteSelection(
  store: ReturnType<typeof createLaidOutStore>,
  annotationLeaf: Extract<ReturnType<typeof selectionLeafSprig.read>, { kind: "annotation" }>,
  threadIndex: number,
) {
  return {
    selection: annotationLeaf.selection,
    threadId: store.editor.getState().documentIndex.document.comments[threadIndex]!.id,
  };
}

function readCursorLeaf(state: ReturnType<typeof setup>, readOnly: boolean) {
  return cursorLeafSprig.read(createLaidOutStore(state), readOnly);
}

function readTableLeaf(store: ReturnType<typeof createLaidOutStore>) {
  const leaf = cursorLeafSprig.read(store, false);

  if (leaf?.kind !== "table") {
    throw new Error("Expected a table leaf");
  }

  return leaf;
}

function createLaidOutStore(
  state: ReturnType<typeof setup>,
  options: Partial<Parameters<typeof createEditorLayoutState>[1]> = {},
) {
  const store = createStore(state.documentIndex.document);
  store.editor.replace(state);
  store.layout.setLayoutResolver(() => resolveTestLayout(state, options));
  store.layout.commit();
  return store;
}

function resolveTestLayout(
  state: ReturnType<typeof setup>,
  options: Partial<Parameters<typeof createEditorLayoutState>[1]> = {},
) {
  return createEditorLayoutState(
    state,
    {
      height: 320,
      paddingX: 0,
      paddingY: 0,
      top: 0,
      width: 640,
      ...options,
    },
    createLayoutCache(),
    null,
  );
}
