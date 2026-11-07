import { expect, test } from "bun:test";
import {
  caretTargetSprig,
  createStore,
  renderedViewportSizeSprig,
  selectionHandlesSprig,
} from "@/component/store";
import {
  createEditorLayoutState,
  createLayoutCache,
  measureCaretTarget,
  measureVisualCaret,
} from "@/editor";
import { setSelection } from "@/editor/state";
import { getPath, setup } from "@test/editor/helpers";

test("rendered viewport size keeps its reference across scroll-only layout commits", () => {
  const store = createStore(setup("alpha\n").documentIndex.document);
  const cache = createLayoutCache();
  let viewport = { height: 120, top: 0, width: 420 };

  store.layout.setLayoutResolver(() =>
    createEditorLayoutState(store.editor.getState(), viewport, cache),
  );
  store.layout.commit();
  const initialSize = renderedViewportSizeSprig.read(store);

  viewport = { ...viewport, top: 80 };
  store.layout.invalidate();
  store.layout.commit();

  expect(renderedViewportSizeSprig.read(store)).toBe(initialSize);

  viewport = { ...viewport, width: 520 };
  store.layout.invalidate();
  store.layout.commit();

  expect(renderedViewportSizeSprig.read(store)).toEqual({ height: 120, width: 520 });
});

test("selection handles sit on visual carets while the caret target stays unshifted", () => {
  const store = createStore(setup("- alpha beta\n").documentIndex.document);
  const cache = createLayoutCache();
  const { path } = getPath(store.editor.getState(), "alpha beta");

  store.layout.setLayoutResolver(() =>
    createEditorLayoutState(store.editor.getState(), { height: 240, top: 0, width: 420 }, cache),
  );
  store.editor.command(setSelection, { anchor: { path, offset: 0 }, focus: { path, offset: 5 } });
  store.layout.commit();

  const { layout } = store.layout.get();
  const start = measureVisualCaret(layout, { path, offset: 0 })!;
  const end = measureVisualCaret(layout, { path, offset: 5 })!;

  expect(start.line.contentInset).toBeGreaterThan(0);
  expect(selectionHandlesSprig.read(store)).toEqual({
    end: { left: end.caret.left, top: end.caret.top + end.caret.height },
    start: { left: start.caret.left, top: start.caret.top },
  });
  expect(caretTargetSprig.read(store)).toEqual(measureCaretTarget(layout, { path, offset: 5 }));
});
