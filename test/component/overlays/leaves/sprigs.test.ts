import { describe, expect, test } from "bun:test";
import { createStore } from "@/component/store";
import { cursorLeafSprig } from "@/component/overlays/leaves/sprigs";
import { createLayoutCache, getDocument, createEditorLayoutState } from "@/editor";
import { addComment } from "@/editor/state";
import { getRegion, placeAt, setup } from "@test/editor/helpers";

describe("overlay leaf sprigs", () => {
  test("emits insertion leaves only when content editing is available", () => {
    const state = setup("");

    expect(readCursorLeaf(state, false)?.kind).toBe("insertion");
    expect(readCursorLeaf(state, true)).toBeNull();
  });

  test("emits table leaves only when content editing is available", () => {
    const state = setup("| Label |\n| --- |\n| Cell |\n");
    const selected = placeAt(state, getRegion(state, "Cell"), 1);

    expect(readCursorLeaf(selected, false)?.kind).toBe("table");
    expect(readCursorLeaf(selected, true)).toBeNull();
  });

  test("prefers cursor link leaves over table leaves", () => {
    const state = setup("| Label |\n| --- |\n| [Docs](https://example.com) |\n");
    const region = getRegion(state, "Docs");
    const selected = placeAt(state, region, 1);

    expect(readCursorLeaf(selected, false)?.kind).toBe("link");
    expect(readCursorLeaf(selected, true)?.kind).toBe("link");
  });

  test("prefers cursor comment leaves over table leaves", () => {
    let state = setup("| Label |\n| --- |\n| Review target |\n");
    const region = getRegion(state, "Review target");
    state =
      addComment(
        state,
        {
          endOffset: "Review".length,
          regionPath: region.path,
          startOffset: 0,
        },
        "note",
      ) ?? state;
    state = placeAt(state, getRegion(state, "Review target"), 2);

    expect(readCursorLeaf(state, false)?.kind).toBe("thread");
    expect(readCursorLeaf(state, true)?.kind).toBe("thread");
  });
});

function readCursorLeaf(state: ReturnType<typeof setup>, readOnly: boolean) {
  const store = createStore(getDocument(state));
  const layout = createLayout(state);

  store.editor.replace(state);
  store.layout.setLayoutResolver(() => layout);
  store.layout.commit();

  return cursorLeafSprig.read(store, readOnly);
}

function createLayout(state: ReturnType<typeof setup>) {
  return createEditorLayoutState(
    state,
    {
      height: 320,
      paddingX: 0,
      paddingY: 0,
      top: 0,
      width: 640,
    },
    createLayoutCache(),
    null,
  );
}
