import { describe, expect, test } from "bun:test";
import { createStore } from "@/component/store";
import { cursorLeafSprig } from "@/component/overlays/leaves/sprigs";
import { createLayoutCache, getDocument, createEditorLayoutState } from "@/editor";
import { addComment } from "@/editor/state";
import { getRegion, placeAt, setup } from "@test/editor/helpers";

describe("overlay leaf sprigs", () => {
  test("prefers cursor link leaves over table leaves", () => {
    const state = setup("| Label |\n| --- |\n| [Docs](https://example.com) |\n");
    const region = getRegion(state, "Docs");
    const selected = placeAt(state, region, 1);
    const store = createStore(getDocument(selected));
    const layout = createLayout(selected);

    store.editor.replace(selected);
    store.layout.setLayoutResolver(() => layout);
    store.layout.commit();

    expect(cursorLeafSprig.read(store, true)?.kind).toBe("link");
  });

  test("prefers cursor comment leaves over table leaves", () => {
    let state = setup("| Label |\n| --- |\n| Review target |\n");
    const region = getRegion(state, "Review target");
    state =
      addComment(
        state,
        {
          endOffset: "Review".length,
          regionId: region.id,
          startOffset: 0,
        },
        "note",
      ) ?? state;
    state = placeAt(state, getRegion(state, "Review target"), 2);
    const store = createStore(getDocument(state));
    const layout = createLayout(state);

    store.editor.replace(state);
    store.layout.setLayoutResolver(() => layout);
    store.layout.commit();

    expect(cursorLeafSprig.read(store, true)?.kind).toBe("thread");
  });
});

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
