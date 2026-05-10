import { describe, expect, test } from "bun:test";
import { createStore } from "@/component/store";
import {
  createParameterizedStoreComputedValue,
  createStoreComputedValue,
} from "@/component/store/core/computed";
import {
  activeCommentThreadIndexValue,
  completionSourcesValue,
  documentCompletionValue,
  normalizedSelectionValue,
} from "@/component/store/editor/computed-values";
import { documentIndexValue, editorStateValue } from "@/component/store/editor/values";
import { presenceValue } from "@/component/store/presence";
import { getDocument } from "@/editor";
import { addComment, insertText, setSelection } from "@/editor/state";
import { getRegion, placeAt, setup } from "@test/editor/helpers";

describe("computed values", () => {
  test("caches one derived value per dependency snapshot", () => {
    const state = setup("alpha\n");
    const store = createStore(getDocument(state));
    let computeCount = 0;
    const computed = createStoreComputedValue([editorStateValue] as const, (_store, state) => {
      computeCount += 1;
      return state.selection.focus;
    });

    const first = computed.read(store);
    const second = computed.read(store);

    expect(first).toBe(second);
    expect(computeCount).toBe(1);
  });

  test("notifies subscribers when the computed output changes", () => {
    const state = setup("alpha\n");
    const store = createStore(getDocument(state));
    const region = getRegion(store.editor.getState(), "alpha");
    let notifications = 0;

    normalizedSelectionValue.subscribe(store, () => {
      notifications += 1;
    });

    store.editor.apply(setSelection(store.editor.getState(), { regionId: region.id, offset: 2 }));

    expect(notifications).toBe(1);
    expect(normalizedSelectionValue.read(store).start.offset).toBe(2);
  });

  test("does not notify when the derived output is equal", () => {
    const state = setup("alpha\n");
    const store = createStore(getDocument(state));
    const region = getRegion(store.editor.getState(), "alpha");
    store.editor.replace(placeAt(store.editor.getState(), region, "end"), "reconciliation");
    let notifications = 0;
    const imageUrlSet = createStoreComputedValue(
      [editorStateValue] as const,
      (_store, state) => new Set(state.documentIndex.imageUrls),
      equalStringSets,
    );

    imageUrlSet.subscribe(store, () => {
      notifications += 1;
    });
    const previous = imageUrlSet.read(store);
    store.editor.apply(insertText(store.editor.getState(), "!"));

    expect(imageUrlSet.read(store)).toBe(previous);
    expect(notifications).toBe(0);
  });

  test("shares the cached derivation across subscribers", () => {
    const state = setup("alpha\n");
    const store = createStore(getDocument(state));
    const region = getRegion(store.editor.getState(), "alpha");
    let computeCount = 0;
    const computed = createStoreComputedValue([editorStateValue] as const, (_store, state) => {
      computeCount += 1;
      return state.selection.focus.offset;
    });

    computed.subscribe(store, () => {});
    computed.subscribe(store, () => {});
    store.editor.apply(setSelection(store.editor.getState(), { regionId: region.id, offset: 2 }));

    expect(computeCount).toBe(2);
  });

  test("unsubscribes computed subscribers", () => {
    const state = setup("alpha\n");
    const store = createStore(getDocument(state));
    const region = getRegion(store.editor.getState(), "alpha");
    let notifications = 0;
    const unsubscribe = normalizedSelectionValue.subscribe(store, () => {
      notifications += 1;
    });

    unsubscribe();
    store.editor.apply(setSelection(store.editor.getState(), { regionId: region.id, offset: 2 }));

    expect(notifications).toBe(0);
  });

  test("recomputes dependency-driven values only when their dependencies change", () => {
    const state = setup("alpha\n");
    const store = createStore(getDocument(state));
    const region = getRegion(store.editor.getState(), "alpha");
    let computeCount = 0;
    let notifications = 0;
    const computed = createStoreComputedValue(
      [documentIndexValue] as const,
      (documintStore, documentIndex) => {
        computeCount += 1;
        return {
          focusOffset: documintStore.editor.getState().selection.focus.offset,
          regionCount: documentIndex.regions.length,
        };
      },
    );

    computed.subscribe(store, () => {
      notifications += 1;
    });
    const previous = computed.read(store);

    store.editor.apply(setSelection(store.editor.getState(), { regionId: region.id, offset: 2 }));

    expect(computed.read(store)).toBe(previous);
    expect(computeCount).toBe(1);
    expect(notifications).toBe(0);

    store.editor.apply(insertText(store.editor.getState(), "!"));

    expect(computed.read(store)).not.toBe(previous);
    expect(computeCount).toBe(2);
    expect(notifications).toBe(1);
  });

  test("treats parameterized computed value params as dependencies", () => {
    const state = setup("alpha\n");
    const store = createStore(getDocument(state));
    let computeCount = 0;
    const computed = createParameterizedStoreComputedValue(
      [documentIndexValue] as const,
      (_documintStore, [label]: readonly [string], documentIndex) => {
        computeCount += 1;
        return `${label}:${documentIndex.regions.length}`;
      },
    );

    const first = computed.read(store, "one");
    const second = computed.read(store, "one");
    const third = computed.read(store, "two");

    expect(first).toBe("one:1");
    expect(second).toBe(first);
    expect(third).toBe("two:1");
    expect(computeCount).toBe(2);
  });

  test("derives parameterized presence from host input", () => {
    const state = setup("alpha beta\n");
    const store = createStore(getDocument(state));
    const resolvedPresence = presenceValue.read(store, [
      {
        cursor: {
          prefix: "alpha",
        },
        id: "user",
        username: "User",
      },
    ]);
    const presence = resolvedPresence?.[0];

    expect(presence?.cursorPoint).toEqual({
      offset: 5,
      regionId: getRegion(state, "alpha beta").id,
    });
    expect(presence?.viewport).toBeNull();
    expect(presenceValue.read(store, undefined)).toBeUndefined();
  });

  test("derives document completion from the active editor selection", () => {
    const state = setup("Hello @Ja\n");
    const store = createStore(getDocument(state));
    const region = getRegion(store.editor.getState(), "Hello @Ja");
    store.editor.apply(
      setSelection(store.editor.getState(), { regionId: region.id, offset: region.text.length }),
    );

    expect(
      documentCompletionValue.read(store, [
        {
          trigger: "@",
          items: [
            { label: "Jane", id: "u-jane" },
            { label: "John", id: "u-john" },
          ],
        },
      ]),
    ).toEqual({
      regionId: region.id,
      trigger: "@",
      query: "Ja",
      triggerStart: 6,
      caret: 9,
      matches: [{ label: "Jane", id: "u-jane" }],
    });
  });

  test("derives shared completion sources from built-ins and host users", () => {
    const state = setup("Hello\n");
    const store = createStore(getDocument(state));

    const sources = completionSourcesValue.read(store, [
      { id: "u-zoe", username: "zoe" },
      { id: "u-amy", username: "amy", fullName: "Amy Adams" },
    ]);

    expect(sources[0]).toEqual({
      trigger: "@",
      items: [
        { label: "Amy Adams", id: "u-amy", kind: "mention" },
        { label: "zoe", id: "u-zoe", kind: "mention" },
      ],
    });
    expect(sources[1]?.trigger).toBe(":");
    expect(sources[1]?.items.some((item) => item.label === "sparkles")).toBe(true);

    expect(completionSourcesValue.read(store, undefined).map((source) => source.trigger)).toEqual([
      ":",
    ]);
  });

  test("preserves parameterized presence output when resolved semantics are equal", () => {
    const state = setup("alpha beta\n");
    const store = createStore(getDocument(state));
    const first = presenceValue.read(store, [
      {
        cursor: {
          prefix: "alpha",
        },
        id: "user",
        username: "User",
      },
    ]);
    const second = presenceValue.read(store, [
      {
        cursor: {
          prefix: "alpha",
        },
        id: "user",
        username: "User",
      },
    ]);

    expect(second).toBe(first);
  });

  test("derives the active comment thread index", () => {
    let state = setup("alpha beta\n");
    const region = getRegion(state, "alpha beta");
    state = setSelection(state, {
      anchor: { regionId: region.id, offset: 0 },
      focus: { regionId: region.id, offset: 5 },
    });
    const commented = addComment(
      state,
      {
        endOffset: 5,
        regionId: region.id,
        startOffset: 0,
      },
      "note",
    );
    const store = createStore(getDocument(commented ?? state));

    expect(activeCommentThreadIndexValue.read(store)).toBe(0);
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
