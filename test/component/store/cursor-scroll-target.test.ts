import { expect, test } from "bun:test";
import { createStore, cursorScrollTargetSprig } from "@/component/store";
import { createEditorLayoutState, createLayoutCache, setSelection } from "@/editor";
import { setup } from "@test/editor/helpers";

test("re-emits cursor scroll target for repeated selection intent", () => {
  const initialState = setup("alpha\n");
  const store = createStore(initialState.documentIndex.document);
  const region = store.editor.getState().documentIndex.regions[0]!;
  const cache = createLayoutCache();
  let viewportTop = 0;
  let notifications = 0;

  store.layout.setLayoutResolver(() =>
    createEditorLayoutState(
      store.editor.getState(),
      {
        height: 120,
        top: viewportTop,
        width: 420,
      },
      cache,
    ),
  );
  store.layout.commit();

  const firstTarget = cursorScrollTargetSprig.read(store);
  const unsubscribe = cursorScrollTargetSprig.subscribe(store, () => {
    notifications += 1;
  });

  viewportTop = 80;
  store.layout.invalidate();
  store.layout.commit();
  expect(notifications).toBe(0);

  store.editor.command(setSelection, { regionId: region.id, offset: 0 });
  const repeatedTarget = cursorScrollTargetSprig.read(store);
  unsubscribe();

  expect(notifications).toBe(1);
  expect(repeatedTarget?.top).toBe(firstTarget?.top);
  expect(repeatedTarget?.bottom).toBe(firstTarget?.bottom);
});
