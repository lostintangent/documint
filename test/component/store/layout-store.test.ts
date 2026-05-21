import { describe, expect, test } from "bun:test";
import { createLayoutStore } from "@/component/store/layout/store";
import type { EditorLayoutState } from "@/editor";
import { createEditorLayoutState, createLayoutCache } from "@/editor";
import { setup } from "@test/editor/helpers";

describe("LayoutStore", () => {
  test("lazily resolves the latest layout and serves it from cache", () => {
    const store = createLayoutStore();
    const first = createLayout({ top: 0 });
    let resolveCount = 0;

    store.setLayoutResolver(() => {
      resolveCount += 1;
      return first;
    });

    expect(store.peekLatest()).toBeNull();
    expect(store.get()).toBe(first);
    expect(store.get()).toBe(first);
    expect(resolveCount).toBe(1);
  });

  test("commit promotes the latest layout to rendered and fires subscribers", () => {
    const store = createLayoutStore();
    const layout = createLayout({ top: 0 });
    let notifications = 0;

    store.setLayoutResolver(() => layout);
    store.subscribe(() => {
      notifications += 1;
    });

    const committed = store.commit();
    expect(committed).toBe(layout);
    expect(store.peekLatest()).toBe(layout);
    expect(store.peekRendered()).toBe(layout);
    expect(notifications).toBe(1);

    // Re-committing the same layout is a no-op for subscribers.
    store.commit();
    expect(notifications).toBe(1);
  });

  test("invalidate clears latest but preserves rendered until the next commit", () => {
    const store = createLayoutStore();
    const first = createLayout({ top: 0 });
    const second = createLayout({ top: 40 });
    let resolveCount = 0;
    let notifications = 0;

    store.setLayoutResolver(() => {
      resolveCount += 1;
      return resolveCount === 1 ? first : second;
    });
    store.subscribe(() => {
      notifications += 1;
    });

    store.commit();
    expect(store.peekRendered()).toBe(first);
    expect(notifications).toBe(1);

    store.invalidate();
    expect(store.peekLatest()).toBeNull();
    // Rendered layout still reflects the last painted frame even though
    // the cache is empty.
    expect(store.peekRendered()).toBe(first);

    // A hit-test-style read repopulates `latest` without touching `rendered`.
    expect(store.get()).toBe(second);
    expect(store.peekLatest()).toBe(second);
    expect(store.peekRendered()).toBe(first);
    expect(notifications).toBe(1);

    // Committing again moves the new latest into rendered.
    store.commit();
    expect(store.peekRendered()).toBe(second);
    expect(notifications).toBe(2);
  });
});

function createLayout({
  state = setup("alpha\n"),
  top,
}: {
  state?: ReturnType<typeof setup>;
  top: number;
}) {
  return createEditorLayoutState(
    state,
    {
      height: 240,
      paddingX: 0,
      paddingY: 0,
      top,
      width: 480,
    },
    createLayoutCache(),
    null,
  ) as EditorLayoutState;
}
