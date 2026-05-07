import { describe, expect, test } from "bun:test";
import { createViewportStore } from "@/component/store/viewport/store";
import type { EditorLayoutState } from "@/editor";
import { prepareLayout, createCanvasRenderCache } from "@/editor";
import { setup } from "@test/editor/helpers";

describe("ViewportStore", () => {
  test("lazily resolves, invalidates, and publishes viewports", () => {
    const store = createViewportStore();
    const first = createViewport({ top: 0 });
    const second = createViewport({ top: 40 });
    let resolveCount = 0;
    let notifications = 0;

    store.setViewportResolver(() => {
      resolveCount += 1;
      return resolveCount === 1 ? first : second;
    });
    store.subscribe(() => {
      notifications += 1;
    });

    expect(store.peek()).toBeNull();
    expect(store.get()).toBe(first);
    expect(store.get()).toBe(first);
    expect(resolveCount).toBe(1);

    store.observeViewport(first);
    expect(store.peek()).toBe(first);
    expect(store.peekPublishedViewport()).toBe(first);
    expect(notifications).toBe(1);

    store.invalidate();
    expect(store.peek()).toBeNull();
    expect(store.peekPublishedViewport()).toBe(first);
    expect(store.get()).toBe(second);

    store.observeViewport(second);
    expect(store.peek()).toBe(second);
    expect(store.peekPublishedViewport()).toBe(second);
    expect(notifications).toBe(2);
  });
});

function createViewport({
  state = setup("alpha\n"),
  top,
}: {
  state?: ReturnType<typeof setup>;
  top: number;
}) {
  return prepareLayout(
    state,
    {
      height: 240,
      paddingX: 0,
      paddingY: 0,
      top,
      width: 480,
    },
    createCanvasRenderCache(),
    null,
  ) as EditorLayoutState;
}
