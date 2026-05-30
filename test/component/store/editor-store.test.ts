import { describe, expect, test } from "bun:test";
import { createSourceSprig } from "@/component/store/core/sprigs";
import { editorSource } from "@/component/store/editor/sprigs";
import { createEditorStore } from "@/component/store/editor/store";
import type { EditorStateTransition } from "@/component/store/editor/transitions";
import { createLayoutStore } from "@/component/store/layout/store";
import { insertText, setSelection } from "@/editor/state";
import { getRegion, placeAt, setup } from "@test/editor/helpers";

describe("EditorStore", () => {
  test("applies command results and publishes transition metadata", () => {
    const state = setup("alpha\n");
    const region = getRegion(state, "alpha");
    const store = createEditorStore(placeAt(state, region, "end"));
    const transitions: EditorStateTransition[] = [];

    store.subscribe((transition) => transitions.push(transition));
    const transition = store.command(insertText, "!");

    expect(transition).not.toBeNull();
    if (!transition) {
      throw new Error("Expected transition");
    }
    expect(transitions).toEqual([transition]);
    expect(store.getState()).toBe(transition.next);
    expect(transition).toEqual(
      expect.objectContaining({
        documentChanged: true,
        changedRootIndexes: [0],
        hasNewAnimations: true,
        source: "local",
      }),
    );
  });

  test("classifies selection-only changes without document changes", () => {
    const state = setup("alpha\n");
    const region = getRegion(state, "alpha");
    const store = createEditorStore(state);
    const transition = store.command(setSelection, { regionId: region.id, offset: 2 });

    expect(transition).toEqual(
      expect.objectContaining({
        documentChanged: false,
        changedRootIndexes: [],
        hasNewAnimations: false,
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

    expect(store.command(() => null)).toBeNull();
    expect(store.command((currentState) => currentState)).toBeNull();
    expect(publishCount).toBe(0);
  });

  test("replaces external content with an external source", () => {
    const store = createEditorStore(setup("alpha\n"));
    const next = setup("beta\n");
    const transition = store.replace(next);

    expect(transition).toEqual(
      expect.objectContaining({
        documentChanged: true,
        changedRootIndexes: [0],
        source: "external",
      }),
    );
    expect(store.getState()).toBe(next);
  });

  test("source sprigs notify only when the selected slice changes", () => {
    const state = setup("alpha\n");
    const region = getRegion(state, "alpha");
    const store = createDocumintStore(state);
    const documentSprig = createSourceSprig(
      editorSource,
      (editorState) => editorState.documentIndex,
    );
    const focusSprig = createSourceSprig(
      editorSource,
      (editorState) => editorState.selection.focus,
    );
    let documentNotifications = 0;
    let focusNotifications = 0;

    documentSprig.subscribe(store, () => {
      documentNotifications += 1;
    });
    focusSprig.subscribe(store, () => {
      focusNotifications += 1;
    });

    store.editor.command(setSelection, { regionId: region.id, offset: 2 });

    expect(documentNotifications).toBe(0);
    expect(focusNotifications).toBe(1);
  });

  test("source sprig subscribers can unsubscribe", () => {
    const state = setup("alpha\n");
    const region = getRegion(state, "alpha");
    const store = createDocumintStore(state);
    const focusSprig = createSourceSprig(
      editorSource,
      (editorState) => editorState.selection.focus,
    );
    let notifications = 0;
    const unsubscribe = focusSprig.subscribe(store, () => {
      notifications += 1;
    });

    unsubscribe();
    store.editor.command(setSelection, { regionId: region.id, offset: 2 });

    expect(notifications).toBe(0);
  });

  test("source sprigs use custom equality to suppress equivalent updates", () => {
    const state = setup("alpha\n");
    const region = getRegion(state, "alpha");
    const store = createDocumintStore(state);
    const imageUrlsSprig = createSourceSprig(
      editorSource,
      (editorState) => new Set(editorState.documentIndex.imageUrls),
      equalStringSets,
    );
    let notifications = 0;

    imageUrlsSprig.subscribe(store, () => {
      notifications += 1;
    });

    store.editor.command(setSelection, { regionId: region.id, offset: 2 });

    expect(notifications).toBe(0);
  });

  test("source sprig reads project the current editor state", () => {
    const state = setup("alpha\n");
    const region = getRegion(state, "alpha");
    const store = createDocumintStore(state);
    const focusSprig = createSourceSprig(
      editorSource,
      (editorState) => editorState.selection.focus,
    );
    let notifications = 0;

    focusSprig.subscribe(store, () => {
      notifications += 1;
    });

    expect(focusSprig.read(store)).toEqual({ regionId: region.id, offset: 0 });

    store.editor.command(setSelection, { regionId: region.id, offset: 2 });

    expect(focusSprig.read(store)).toEqual({ regionId: region.id, offset: 2 });
    expect(notifications).toBe(1);
  });
});

function createDocumintStore(state: ReturnType<typeof setup>) {
  return { editor: createEditorStore(state), layout: createLayoutStore() };
}

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
