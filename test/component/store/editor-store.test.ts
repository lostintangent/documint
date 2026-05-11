import { describe, expect, test } from "bun:test";
import { createEditorValue } from "@/component/store/core/values";
import { createEditorStore } from "@/component/store/editor/store";
import type { EditorStateTransition } from "@/component/store/editor/transitions";
import { createViewportStore } from "@/component/store/viewport/store";
import { insertText, setSelection } from "@/editor/state";
import { getRegion, placeAt, setup } from "@test/editor/helpers";

describe("EditorStore", () => {
  test("applies command results and publishes transition metadata", () => {
    const state = setup("alpha\n");
    const region = getRegion(state, "alpha");
    const store = createEditorStore(placeAt(state, region, "end"));
    const transitions: EditorStateTransition[] = [];

    store.subscribe((transition) => transitions.push(transition));
    const transition = store.apply(insertText(store.getState(), "!"));

    expect(transition).not.toBeNull();
    if (!transition) {
      throw new Error("Expected transition");
    }
    expect(transitions).toEqual([transition]);
    expect(store.getState()).toBe(transition.next);
    expect(transition).toEqual(
      expect.objectContaining({
        documentChanged: true,
        animationsChanged: true,
        source: "local",
      }),
    );
  });

  test("classifies selection-only changes without document changes", () => {
    const state = setup("alpha\n");
    const region = getRegion(state, "alpha");
    const store = createEditorStore(state);
    const transition = store.apply(setSelection(state, { regionId: region.id, offset: 2 }));

    expect(transition).toEqual(
      expect.objectContaining({
        documentChanged: false,
        animationsChanged: false,
        source: "local",
      }),
    );
  });

  test("does not publish null or identity updates", () => {
    const state = setup("alpha\n");
    const store = createEditorStore(state);
    let publishCount = 0;

    store.subscribe(() => {
      publishCount += 1;
    });

    expect(store.apply(null)).toBeNull();
    expect(store.apply(state)).toBeNull();
    expect(publishCount).toBe(0);
  });

  test("replaces external content with an explicit source", () => {
    const store = createEditorStore(setup("alpha\n"));
    const next = setup("beta\n");
    const transition = store.replace(next, "external");

    expect(transition).toEqual(
      expect.objectContaining({
        documentChanged: true,
        source: "external",
      }),
    );
    expect(store.getState()).toBe(next);
  });

  test("notifies value subscribers only when the selected source changes", () => {
    const state = setup("alpha\n");
    const region = getRegion(state, "alpha");
    const store = createEditorStore(state);
    let documentNotifications = 0;
    let focusNotifications = 0;

    store.subscribeValue(
      (editorState) => editorState.documentIndex,
      () => {
        documentNotifications += 1;
      },
    );
    store.subscribeValue(
      (editorState) => editorState.selection.focus,
      () => {
        focusNotifications += 1;
      },
    );

    store.apply(setSelection(state, { regionId: region.id, offset: 2 }));

    expect(documentNotifications).toBe(0);
    expect(focusNotifications).toBe(1);
  });

  test("unsubscribes value subscribers", () => {
    const state = setup("alpha\n");
    const region = getRegion(state, "alpha");
    const store = createEditorStore(state);
    let notifications = 0;
    const unsubscribe = store.subscribeValue(
      (editorState) => editorState.selection.focus,
      () => {
        notifications += 1;
      },
    );

    unsubscribe();
    store.apply(setSelection(state, { regionId: region.id, offset: 2 }));

    expect(notifications).toBe(0);
  });

  test("uses value equality to ignore equivalent values", () => {
    const state = setup("alpha\n");
    const region = getRegion(state, "alpha");
    const store = createEditorStore(state);
    let notifications = 0;

    store.subscribeValue(
      (editorState) => new Set(editorState.documentIndex.imageUrls),
      () => {
        notifications += 1;
      },
      equalStringSets,
    );

    store.apply(setSelection(state, { regionId: region.id, offset: 2 }));

    expect(notifications).toBe(0);
  });

  test("exposes editor-backed store values", () => {
    const state = setup("alpha\n");
    const region = getRegion(state, "alpha");
    const store = { editor: createEditorStore(state), viewport: createViewportStore() };
    const focusValue = createEditorValue((editorState) => editorState.selection.focus);
    let notifications = 0;

    focusValue.subscribe(store, () => {
      notifications += 1;
    });

    expect(focusValue.read(store)).toEqual({ regionId: region.id, offset: 0 });

    store.editor.apply(setSelection(state, { regionId: region.id, offset: 2 }));

    expect(focusValue.read(store)).toEqual({ regionId: region.id, offset: 2 });
    expect(notifications).toBe(1);
  });
});

function equalStringSets(a: ReadonlySet<string>, b: ReadonlySet<string>) {
  if (a === b) return true;
  if (a.size !== b.size) return false;

  for (const value of a) {
    if (!b.has(value)) {
      return false;
    }
  }

  return true;
}
