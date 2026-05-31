import { expect, test } from "bun:test";
import { createStore, renderedViewportSizeSprig } from "@/component/store";
import { createEditorLayoutState, createLayoutCache } from "@/editor";
import { setup } from "@test/editor/helpers";

test("rendered viewport size ignores scroll-only layout commits", () => {
  const initialState = setup("alpha\n");
  const store = createStore(initialState.documentIndex.document);
  const cache = createLayoutCache();
  let viewport = { height: 120, top: 0, width: 420 };
  let notifications = 0;

  store.layout.setLayoutResolver(() =>
    createEditorLayoutState(store.editor.getState(), viewport, cache),
  );
  store.layout.commit();

  renderedViewportSizeSprig.subscribe(store, () => {
    notifications += 1;
  });
  const initialSize = renderedViewportSizeSprig.read(store);

  viewport = { ...viewport, top: 80 };
  store.layout.invalidate();
  store.layout.commit();

  expect(notifications).toBe(0);
  expect(renderedViewportSizeSprig.read(store)).toBe(initialSize);

  viewport = { ...viewport, width: 520 };
  store.layout.invalidate();
  store.layout.commit();

  expect(notifications).toBe(1);
  expect(renderedViewportSizeSprig.read(store)).toEqual({ height: 120, width: 520 });
});
