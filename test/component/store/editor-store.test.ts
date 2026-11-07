import { describe, expect, test } from "bun:test";
import { createEditorStore } from "@/component/store/editor/store";
import type { EditorStateTransition } from "@/component/store/editor/transitions";
import { insertText, readEditorEffects, setSelection } from "@/editor/state";
import { getPath, placeAt, setup } from "@test/editor/helpers";

describe("EditorStore", () => {
  test("applies command results and publishes transition metadata", () => {
    const state = setup("alpha\n");
    const path = getPath(state, "alpha");
    const store = createEditorStore(placeAt(state, path, "end"));
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
        source: "local",
      }),
    );
    expect(transition.effects.length).toBeGreaterThan(0);
  });

  test("classifies selection-only changes without document changes", () => {
    const state = setup("alpha\n");
    const path = getPath(state, "alpha");
    const store = createEditorStore(state);
    const transition = store.command(setSelection, { path: path.path, offset: 2 });

    expect(transition).toEqual(
      expect.objectContaining({
        documentChanged: false,
        changedRootIndexes: [],
        effects: [],
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

  test("drains but does not publish effects from external replacements", () => {
    const initial = setup("alpha\n");
    const path = getPath(initial, "alpha");
    const next = insertText(placeAt(initial, path, "end"), "!");

    if (!next) {
      throw new Error("Expected insertText to produce a state");
    }

    expect(readEditorEffects(next).length).toBeGreaterThan(0);

    const store = createEditorStore(initial);
    const transition = store.replace(next);

    expect(transition).toEqual(
      expect.objectContaining({
        effects: [],
        source: "external",
      }),
    );
    expect(readEditorEffects(next)).toEqual([]);
  });
});
