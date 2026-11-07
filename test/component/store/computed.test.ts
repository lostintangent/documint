import { indexedTextEntries } from "@test/editor/helpers";
import { describe, expect, test } from "bun:test";
import { createStore, type DocumintStore } from "@/component/store";
import { createParameterizedSprig, createComputedSprig } from "@/component/store/core/computed";
import {
  activeCommentIndexSprig,
  documentCompletionSprig,
} from "@/component/store/editor/computed-sprigs";
import {
  documentIndexSprig,
  editorStateSprig,
  selectionSprig,
} from "@/component/store/editor/sprigs";
import { renderedLayoutSprig } from "@/component/store/layout/sprigs";
import { commentPresenceSprig, resolvedPresenceSprig } from "@/component/store/presence";
import { createEditorLayoutState, createLayoutCache, type DocumentUserPresence } from "@/editor";
import { addComment, resolveThread, setSelection } from "@/editor/state";
import { getPath, setup } from "@test/editor/helpers";

describe("computed sprigs", () => {
  test("caches one derived value per dependency snapshot", () => {
    const state = setup("alpha\n");
    const store = createStore(state.documentIndex.document);
    let computeCount = 0;
    const computed = createComputedSprig([editorStateSprig], (_store, state) => {
      computeCount += 1;
      return state.selection.focus;
    });

    const first = computed.read(store);
    const second = computed.read(store);

    expect(first).toBe(second);
    expect(computeCount).toBe(1);
  });

  test("skips dep reads until a source changes", () => {
    const state = setup("alpha\n");
    const store = createStore(state.documentIndex.document);
    const path = getPath(store.editor.getState(), "alpha");
    let depReads = 0;
    let computeCount = 0;
    const countedDocumentIndexSprig = {
      ...documentIndexSprig,
      read: (documintStore: DocumintStore) => {
        depReads += 1;
        return documentIndexSprig.read(documintStore);
      },
    };
    const computed = createComputedSprig([countedDocumentIndexSprig], (_store, documentIndex) => {
      computeCount += 1;
      return { pathCount: indexedTextEntries(documentIndex).length };
    });

    const first = computed.read(store);
    computed.read(store);

    expect(depReads).toBe(1);

    store.editor.command(setSelection, { path: path.path, offset: 2 });

    expect(computed.read(store)).toBe(first);
    expect(depReads).toBe(2);
    expect(computeCount).toBe(1);
  });

  test("treats parameterized sprig params as dependencies", () => {
    const state = setup("alpha\n");
    const store = createStore(state.documentIndex.document);
    let computeCount = 0;
    const computed = createParameterizedSprig(
      [documentIndexSprig],
      (_documintStore, [label]: readonly [string], documentIndex) => {
        computeCount += 1;
        return `${label}:${indexedTextEntries(documentIndex).length}`;
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

  test("notifies consumers through sources reached only via nested deps", () => {
    const store = createStore(setup("alpha\n").documentIndex.document);
    const cache = createLayoutCache();
    let viewport = { height: 120, top: 0, width: 420 };
    let notifications = 0;
    store.layout.setLayoutResolver(() =>
      createEditorLayoutState(store.editor.getState(), viewport, cache),
    );
    store.layout.commit();
    const scrollTopSprig = createComputedSprig(
      [renderedLayoutSprig],
      (_store, layout) => layout?.viewport.top ?? null,
    );
    const consumer = createComputedSprig(
      [selectionSprig, scrollTopSprig, editorStateSprig],
      (_store, selection, scrollTop) => ({ focus: selection.focus.offset, scrollTop }),
    );

    expect(consumer.sources).toEqual([...selectionSprig.sources, ...renderedLayoutSprig.sources]);

    // Subscribe the way `useSprig` does: one listener per declared source.
    for (const source of consumer.sources) {
      source.subscribe(store, () => {
        notifications += 1;
      });
    }
    expect(consumer.read(store).scrollTop).toBe(0);

    viewport = { ...viewport, top: 80 };
    store.layout.invalidate();
    store.layout.commit();

    expect(notifications).toBe(1);
    expect(consumer.read(store).scrollTop).toBe(80);
  });

  test("resolves host presence against text and comment thread cursors", () => {
    const state = setupPresenceCommentState();
    const store = createStore(state.documentIndex.document);
    const path = getPath(state, "alpha beta gamma");
    const [unresolvedThread, resolvedThread] = state.documentIndex.document.comments;

    if (!unresolvedThread || !resolvedThread) {
      throw new Error("Expected comment threads");
    }

    const userPresence: DocumentUserPresence[] = [
      {
        color: "#f97316",
        cursor: { threadId: unresolvedThread.id },
        id: "unresolved-user",
        username: "Unresolved",
      },
      { cursor: { threadId: resolvedThread.id }, id: "resolved-user", username: "Resolved" },
      {
        cursor: { prefix: "alpha" },
        id: "text-user",
        status: "Reviewing introduction",
        username: "Text",
      },
    ];
    const resolvedPresence = resolvedPresenceSprig.read(store, userPresence);

    expect(resolvedPresence).toEqual([
      {
        ...userPresence[0]!,
        commentThreadIndex: 0,
        cursorPoint: null,
        isOnUnresolvedCommentThread: true,
        viewport: null,
      },
      {
        ...userPresence[1]!,
        commentThreadIndex: 1,
        cursorPoint: null,
        isOnUnresolvedCommentThread: false,
        viewport: null,
      },
      {
        ...userPresence[2]!,
        commentThreadIndex: null,
        cursorPoint: { offset: "alpha".length, path: path.path },
        isOnUnresolvedCommentThread: false,
        viewport: null,
      },
    ]);
    expect(commentPresenceSprig.read(store, userPresence)).toEqual(
      new Map([
        [0, resolvedPresence![0]!],
        [1, resolvedPresence![1]!],
      ]),
    );
    expect(resolvedPresenceSprig.read(store, undefined)).toBeUndefined();
  });

  test("preserves parameterized presence output when resolved semantics are equal", () => {
    const state = setup("alpha beta\n");
    const store = createStore(state.documentIndex.document);
    const first = resolvedPresenceSprig.read(store, [
      {
        cursor: {
          prefix: "alpha",
        },
        id: "user",
        username: "User",
      },
    ]);
    const second = resolvedPresenceSprig.read(store, [
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

  test("recomputes presence output when presence status changes", () => {
    const state = setup("alpha beta\n");
    const store = createStore(state.documentIndex.document);
    const first = resolvedPresenceSprig.read(store, [
      {
        cursor: {
          prefix: "alpha",
        },
        id: "user",
        status: "Reading",
        username: "User",
      },
    ]);
    const second = resolvedPresenceSprig.read(store, [
      {
        cursor: {
          prefix: "alpha",
        },
        id: "user",
        status: "Editing",
        username: "User",
      },
    ]);

    expect(second).not.toBe(first);
    expect(second?.[0]?.status).toBe("Editing");
  });

  test("derives document completion from the active editor selection", () => {
    const state = setup("Hello @Ja\n");
    const store = createStore(state.documentIndex.document);
    const path = getPath(store.editor.getState(), "Hello @Ja");
    store.editor.command(setSelection, { path: path.path, offset: path.text.length });

    expect(
      documentCompletionSprig.read(store, [
        {
          trigger: "@",
          items: [
            { label: "Jane", id: "u-jane" },
            { label: "John", id: "u-john" },
          ],
        },
      ]),
    ).toEqual({
      path: path.path,
      trigger: "@",
      query: "Ja",
      triggerStart: 6,
      caret: 9,
      matches: [{ label: "Jane", id: "u-jane" }],
    });
  });

  test("derives the active comment thread index", () => {
    let state = setup("alpha beta\n");
    const path = getPath(state, "alpha beta");
    state = setSelection(state, {
      anchor: { path: path.path, offset: 0 },
      focus: { path: path.path, offset: 5 },
    });
    const commented = addComment(
      state,
      {
        endOffset: 5,
        path: path.path,
        startOffset: 0,
      },
      "note",
    );
    const store = createStore((commented ?? state).documentIndex.document);

    expect(activeCommentIndexSprig.read(store, false)).toBe(0);
    expect(activeCommentIndexSprig.read(store, true)).toBeNull();
  });
});

function setupPresenceCommentState() {
  let state = setup("alpha beta gamma\n");
  const path = getPath(state, "alpha beta gamma");

  state =
    addComment(
      state,
      {
        endOffset: "alpha".length,
        path: path.path,
        startOffset: 0,
      },
      "Unresolved thread",
    ) ?? state;

  state =
    addComment(
      state,
      {
        endOffset: "alpha beta".length,
        path: path.path,
        startOffset: "alpha ".length,
      },
      "Resolved thread",
    ) ?? state;

  return resolveThread(state, 1, true) ?? state;
}
