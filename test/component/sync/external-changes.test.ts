import { indexedTextEntries } from "@test/editor/helpers";
import { describe, expect, test } from "bun:test";
import {
  acknowledgeUnacknowledgedDocumentChanges,
  mergeUnacknowledgedDocumentChanges,
  type UnacknowledgedDocumentChange,
} from "@/component/sync/external-changes";
import {
  documentNodeAnchorKey,
  findDocumentChanges,
  type DocumentChange,
} from "@/document";
import { createEditorState, setSelection } from "@/editor/state";
import { parseDocument } from "@/markdown";

describe("external change targets", () => {
  test("detects modified text roots", () => {
    const targets = diff("Alpha\n", "Alpine\n");

    expect(targets).toEqual([
      expect.objectContaining({
        kind: "modified",
        anchor: expect.objectContaining({
          kind: "block",
          path: "root.0",
        }),
      }),
    ]);
  });

  test("classifies inserted roots as added without marking shifted suffixes", () => {
    const targets = diff("Alpha\n\nBeta\n", "Intro\n\nAlpha\n\nBeta\n");

    expect(targets).toHaveLength(1);
    expect(targets[0]).toMatchObject({
      kind: "added",
      anchor: {
        kind: "block",
        path: "root.0",
      },
    });
  });

  test("detects checkbox changes at list-item granularity", () => {
    const targets = diff("- [ ] task\n", "- [x] task\n");

    expect(targets).toHaveLength(1);
    expect(targets[0]).toMatchObject({
      kind: "modified",
      anchor: { kind: "block" },
    });
  });

  test("detects changed table cells", () => {
    const nextState = createState("| A | B |\n| - | - |\n| one | three |\n");
    const targets = diff(
      "| A | B |\n| - | - |\n| one | two |\n",
      "| A | B |\n| - | - |\n| one | three |\n",
    );
    const changedCell = indexedTextEntries(nextState).find((path) => path.text === "three");

    expect(targets).toHaveLength(1);
    expect(changedCell).toBeDefined();
    expect(targets[0]).toMatchObject({
      kind: "modified",
      anchor: {
        kind: "table-cell",
        path: changedCell!.path,
      },
    });
  });

  test("classifies inserted table rows as added without marking shifted rows", () => {
    const targets = diff(
      "| A | B |\n| - | - |\n| one | two |\n| three | four |\n",
      "| A | B |\n| - | - |\n| one | two |\n| new | row |\n| three | four |\n",
    );

    expect(targets).toHaveLength(2);
    expect(targets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "added",
          anchor: expect.objectContaining({ kind: "table-cell" }),
        }),
      ]),
    );
    expect(targets.every((target) => target.kind === "added")).toBe(true);
  });

  test("classifies inserted rows before modified rows in the same snapshot", () => {
    const targets = diff(
      "| A | B |\n| - | - |\n| one | two |\n| three | four |\n",
      "| A | B |\n| - | - |\n| new | row |\n| one | two updated |\n| three | four |\n",
    );

    expect(targets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "modified",
          anchor: expect.objectContaining({
            kind: "table-cell",
            path: "root.0.rows.2.cells.1",
          }),
        }),
        expect.objectContaining({
          kind: "added",
          anchor: expect.objectContaining({
            kind: "table-cell",
            path: "root.0.rows.1.cells.0",
          }),
        }),
        expect.objectContaining({
          kind: "added",
          anchor: expect.objectContaining({
            kind: "table-cell",
            path: "root.0.rows.1.cells.1",
          }),
        }),
      ]),
    );
    expect(targets).toHaveLength(3);
  });

  test("classifies inserted table columns as added without marking shifted cells", () => {
    const targets = diff(
      "| A | B |\n| - | - |\n| one | two |\n",
      "| A | New | B |\n| - | - | - |\n| one | inserted | two |\n",
    );

    expect(targets).toHaveLength(2);
    expect(targets.every((target) => target.kind === "added")).toBe(true);
  });

  test("classifies inserted columns before modified cells in the same snapshot", () => {
    const targets = diff(
      "| A | B | C |\n| - | - | - |\n| one | two | three |\n",
      "| A | New | B | C |\n| - | - | - | - |\n| one | inserted | two changed | three |\n",
    );

    expect(targets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "modified",
          anchor: expect.objectContaining({
            kind: "table-cell",
            path: "root.0.rows.1.cells.2",
          }),
        }),
        expect.objectContaining({
          kind: "added",
          anchor: expect.objectContaining({
            kind: "table-cell",
            path: "root.0.rows.0.cells.1",
          }),
        }),
        expect.objectContaining({
          kind: "added",
          anchor: expect.objectContaining({
            kind: "table-cell",
            path: "root.0.rows.1.cells.1",
          }),
        }),
      ]),
    );
    expect(targets).toHaveLength(3);
  });

  test("returns no new changes for noisy broad rewrites", () => {
    const previous = Array.from({ length: 12 }, (_, index) => `Old ${index}`).join("\n\n");
    const next = Array.from({ length: 12 }, (_, index) => `New ${index}`).join("\n\n");

    expect(diff(previous, next)).toEqual([]);
  });

  test("returns no new changes for over-budget targeted diffs instead of partial changes", () => {
    const previous = createTable(2);
    const next = createTable(80);

    expect(diff(previous, next)).toEqual([]);
  });
});

describe("unacknowledged document changes", () => {
  test("merges targets, consumes repeated targets, and reports only new fade targets", () => {
    let state = createState("Alpha\n\nBeta\n\nGamma\n");
    const third = indexedTextEntries(state)[2];

    if (!third) {
      throw new Error("Expected three paths");
    }

    state = setSelection(state, { path: third.path, offset: 0 });
    const current = [
      resolveChangeForState(
        state,
        changeAt(diff("Old\n\nBeta\n\nGamma\n", "Alpha\n\nBeta\n\nGamma\n"), "root.0"),
      ),
    ];
    const next = mergeUnacknowledgedDocumentChanges(
      current,
      [
        changeAt(diff("Beta\n\nGamma\n", "Alpha\n\nBeta\n\nGamma\n"), "root.0"),
        changeAt(diff("Alpha\n\nOld\n\nGamma\n", "Alpha\n\nBeta\n\nGamma\n"), "root.1"),
      ],
      state,
    );

    expect(next.changes.map((change) => change.change.kind)).toEqual([
      "modified",
      "modified",
    ]);
    expect(next.newChanges).toEqual([next.changes[1]]);
  });

  test("keeps unacknowledged added blocks added when later external snapshots modify them", () => {
    const initialState = createState("Alpha\n\nOther\n");
    let state = createState("Alpha updated\n\nOther\n");
    const otherPath = indexedTextEntries(state)[1];

    if (!otherPath) {
      throw new Error("Expected paths");
    }

    state = setSelection(state, { path: otherPath.path, offset: 0 });

    const current = resolveChangeForState(
      initialState,
      changeAt(diff("Other\n", "Alpha\n\nOther\n"), "root.0"),
    );
    const incoming = changeAt(diff("Alpha\n\nOther\n", "Alpha updated\n\nOther\n"), "root.0");
    const next = mergeUnacknowledgedDocumentChanges([current], [incoming], state);

    expect(next.changes).toHaveLength(1);
    expect(next.changes[0]!.change).toMatchObject({
      kind: "added",
      anchor: incoming.anchor,
    });
    expect(next.newChanges).toEqual([]);
  });

  test("keeps unacknowledged added table cells added when later external snapshots modify them", () => {
    const initialState = createState("| A | B |\n| - | - |\n| one | new |\n");
    const state = createState("| A | B |\n| - | - |\n| one | changed |\n");

    const current = resolveChangeForState(
      initialState,
      changeAt(
        diff("| A |\n| - |\n| one |\n", "| A | B |\n| - | - |\n| one | new |\n"),
        "root.0.rows.1.cells.1",
      ),
    );
    const incoming = changeAt(
      diff("| A | B |\n| - | - |\n| one | new |\n", "| A | B |\n| - | - |\n| one | changed |\n"),
      "root.0.rows.1.cells.1",
    );
    const next = mergeUnacknowledgedDocumentChanges([current], [incoming], state);

    expect(next.changes).toHaveLength(1);
    expect(next.changes[0]!.change).toMatchObject({
      kind: "added",
      anchor: incoming.anchor,
    });
    expect(next.newChanges).toEqual([]);
  });

  test("refreshes unacknowledged modified blocks without reporting a new fade target", () => {
    const initialState = createState("Alpha\n\nOther\n");
    let state = createState("Alpine\n\nOther\n");
    const otherPath = indexedTextEntries(state)[1];

    if (!otherPath) {
      throw new Error("Expected paths");
    }

    state = setSelection(state, { path: otherPath.path, offset: 0 });

    const current = resolveChangeForState(
      initialState,
      changeAt(diff("Old\n\nOther\n", "Alpha\n\nOther\n"), "root.0"),
    );
    if (current.change.kind !== "modified") {
      throw new Error("Expected current modified change");
    }
    const incoming = changeAt(diff("Alpha\n\nOther\n", "Alpine\n\nOther\n"), "root.0");
    const next = mergeUnacknowledgedDocumentChanges([current], [incoming], state);

    expect(next.changes).toHaveLength(1);
    expect(next.changes[0]!.change).toMatchObject({
      kind: "modified",
      previousAnchor: current.change.previousAnchor,
      anchor: incoming.anchor,
    });
    expect(next.newChanges).toEqual([]);
  });

  test("does not add changes for the current selection target", () => {
    const state = createState("Alpha\n");
    const path = indexedTextEntries(state)[0];

    if (!path) {
      throw new Error("Expected path");
    }

    expect(
      mergeUnacknowledgedDocumentChanges([], [changeAt(diff("Old\n", "Alpha\n"), "root.0")], state),
    ).toEqual({ newChanges: [], changes: [] });
  });

  test("keeps fresh modified block changes when the new content is duplicated", () => {
    let state = createState("Same\n\nSame\n");
    const secondPath = indexedTextEntries(state)[1];

    if (!secondPath) {
      throw new Error("Expected second path");
    }

    state = setSelection(state, { path: secondPath.path, offset: 0 });
    const incoming = changeAt(diff("Old\n\nSame\n", "Same\n\nSame\n"), "root.0");
    const next = mergeUnacknowledgedDocumentChanges([], [incoming], state);

    expect(next.changes).toHaveLength(1);
    expect(next.changes[0]!.change).toBe(incoming);
    expect(next.newChanges).toEqual(next.changes);
  });

  test("keeps fresh modified table-cell changes when the new content is duplicated", () => {
    let state = createState("| A | B |\n| - | - |\n| same | same |\n");
    const secondCell = indexedTextEntries(state).find(
      (path) => path.path === "root.0.rows.1.cells.1",
    );

    if (!secondCell) {
      throw new Error("Expected second table cell");
    }

    state = setSelection(state, { path: secondCell.path, offset: 0 });
    const incoming = changeAt(
      diff("| A | B |\n| - | - |\n| old | same |\n", "| A | B |\n| - | - |\n| same | same |\n"),
      "root.0.rows.1.cells.0",
    );
    const next = mergeUnacknowledgedDocumentChanges([], [incoming], state);

    expect(next.changes).toHaveLength(1);
    expect(next.changes[0]!.change).toBe(incoming);
    expect(next.newChanges).toEqual(next.changes);
  });

  test("retargets existing changes when a later external snapshot has no targetable changes", () => {
    const initial = createState("Alpha\n\nBeta\n");
    const beta = indexedTextEntries(initial).find((path) => path.text === "Beta");
    const next = createState("Intro\n\nAlpha\n\nBeta\n");
    const shiftedBeta = indexedTextEntries(next).find((path) => path.text === "Beta");

    if (!beta || !shiftedBeta) {
      throw new Error("Expected beta paths");
    }

    const active = resolveChangeForState(
      initial,
      changeAt(diff("Alpha\n\nOld\n", "Alpha\n\nBeta\n"), "root.1"),
    );

    expect(mergeUnacknowledgedDocumentChanges([active], [], next)).toEqual({
      newChanges: [],
      changes: [
        expect.objectContaining({
          change: expect.objectContaining({
            kind: "modified",
            anchor: expect.objectContaining({
              kind: "block",
              path: "root.2",
            }),
          }),
          editorTarget: expect.objectContaining({
            path: "root.2",
            kind: "block",
          }),
          changeKey: active.changeKey,
        }),
      ],
    });
  });

  test("retargets active changes when an external insert shifts block paths", () => {
    const initial = createState("Alpha\n\nBeta\n");
    const beta = indexedTextEntries(initial).find((path) => path.text === "Beta");
    const next = createState("Intro\n\nAlpha\n\nBeta\n");
    const shiftedBeta = indexedTextEntries(next).find((path) => path.text === "Beta");

    if (!beta || !shiftedBeta) {
      throw new Error("Expected beta paths");
    }

    const active = resolveChangeForState(
      initial,
      changeAt(diff("Alpha\n\nOld\n", "Alpha\n\nBeta\n"), "root.1"),
    );

    expect(mergeUnacknowledgedDocumentChanges([active], [], next)).toEqual({
      newChanges: [],
      changes: [
        expect.objectContaining({
          change: expect.objectContaining({
            kind: "modified",
            anchor: expect.objectContaining({
              kind: "block",
              path: "root.2",
            }),
          }),
          editorTarget: expect.objectContaining({
            path: "root.2",
            kind: "block",
          }),
          changeKey: active.changeKey,
        }),
      ],
    });
  });

  test("acknowledges after retargeting instead of dismissing selected stale block paths", () => {
    const initial = createState("Alpha\n\nBeta\n");
    let next = createState("Stale occupant\n\nAlpha\n\nBeta\n");
    const stalePath = indexedTextEntries(next).find((path) => path.text === "Alpha");

    if (!stalePath) {
      throw new Error("Expected stale path path");
    }

    next = setSelection(next, { path: stalePath.path, offset: 0 });
    const active = resolveChangeForState(
      initial,
      changeAt(diff("Alpha\n\nOld\n", "Alpha\n\nBeta\n"), "root.1"),
    );

    expect(acknowledgeUnacknowledgedDocumentChanges([active], next, { retarget: true })).toEqual([
      expect.objectContaining({
        editorTarget: expect.objectContaining({
          path: "root.2",
          kind: "block",
        }),
      }),
    ]);
  });

  test("drops active changes when the anchor is absent even if the stale block path exists", () => {
    const initial = createState("Alpha\n\nBeta\n");
    const next = createState("Alpha\n\nStale occupant\n");
    const active = resolveChangeForState(
      initial,
      changeAt(diff("Alpha\n\nOld\n", "Alpha\n\nBeta\n"), "root.1"),
    );

    expect(acknowledgeUnacknowledgedDocumentChanges([active], next, { retarget: true })).toEqual(
      [],
    );
  });

  test("retargets active table-cell changes when an external row insert shifts cell paths", () => {
    const initial = createState("| A | B |\n| - | - |\n| one | two |\n");
    const cell = indexedTextEntries(initial).find((path) => path.text === "two");
    const next = createState("| A | B |\n| - | - |\n| new | row |\n| one | two |\n");
    const shiftedCell = indexedTextEntries(next).find((path) => path.text === "two");

    if (!cell || !shiftedCell) {
      throw new Error("Expected table cell paths");
    }

    const active = resolveChangeForState(
      initial,
      changeAt(
        diff("| A | B |\n| - | - |\n| one | old |\n", "| A | B |\n| - | - |\n| one | two |\n"),
        "root.0.rows.1.cells.1",
      ),
    );

    expect(mergeUnacknowledgedDocumentChanges([active], [], next)).toEqual({
      newChanges: [],
      changes: [
        expect.objectContaining({
          change: expect.objectContaining({
            kind: "modified",
            anchor: expect.objectContaining({
              kind: "table-cell",
              path: "root.0.rows.2.cells.1",
            }),
          }),
          editorTarget: expect.objectContaining({
            kind: "table-cell",
            path: "root.0.rows.2.cells.1",
          }),
          changeKey: active.changeKey,
        }),
      ],
    });
  });

  test("acknowledges after retargeting instead of dismissing selected stale table-cell paths", () => {
    const initial = createState("| A | B |\n| - | - |\n| one | two |\n");
    let next = createState("| A | B |\n| - | - |\n| stale | occupant |\n| one | two |\n");
    const staleCell = indexedTextEntries(next).find(
      (path) => path.path === "root.0.rows.1.cells.1",
    );

    if (!staleCell) {
      throw new Error("Expected stale path table cell");
    }

    next = setSelection(next, { path: staleCell.path, offset: 0 });
    const active = resolveChangeForState(
      initial,
      changeAt(
        diff("| A | B |\n| - | - |\n| one | old |\n", "| A | B |\n| - | - |\n| one | two |\n"),
        "root.0.rows.1.cells.1",
      ),
    );

    expect(acknowledgeUnacknowledgedDocumentChanges([active], next, { retarget: true })).toEqual([
      expect.objectContaining({
        editorTarget: expect.objectContaining({
          kind: "table-cell",
          path: "root.0.rows.2.cells.1",
        }),
      }),
    ]);
  });

  test("preserves surviving change order when acknowledge drops and retargets entries", () => {
    const initialMarkdown = [
      "Drop",
      "",
      "| A | B |",
      "| - | - |",
      "| one | two |",
      "",
      "Keep",
      "",
    ].join("\n");
    const initial = createState(initialMarkdown);
    let next = createState(
      [
        "Drop",
        "",
        "| A | B |",
        "| - | - |",
        "| inserted | row |",
        "| one | two |",
        "",
        "Keep",
        "",
      ].join("\n"),
    );
    const droppedPath = indexedTextEntries(next).find(
      (path) => path.text === "Drop",
    );

    if (!droppedPath) {
      throw new Error("Expected dropped path");
    }

    next = setSelection(next, {
      path: droppedPath.path,
      offset: 0,
    });

    const dropped = resolveChangeForState(
      initial,
      changeAt(
        diff(initialMarkdown.replace("Drop", "Old drop"), initialMarkdown),
        "root.0",
      ),
    );
    const retargeted = resolveChangeForState(
      initial,
      changeAt(
        diff(initialMarkdown.replace("two", "old"), initialMarkdown),
        "root.1.rows.1.cells.1",
      ),
    );
    const retained = resolveChangeForState(
      initial,
      changeAt(
        diff(initialMarkdown.replace("Keep", "Old keep"), initialMarkdown),
        "root.2",
      ),
    );
    const acknowledged = acknowledgeUnacknowledgedDocumentChanges(
      [dropped, retargeted, retained],
      next,
      { retarget: true },
    );

    expect(acknowledged.map((change) => change.changeKey)).toEqual([
      retargeted.changeKey,
      retained.changeKey,
    ]);
    expect(acknowledged.map((change) => change.change.anchor.path)).toEqual([
      "root.1.rows.2.cells.1",
      "root.2",
    ]);
  });

  test("drops active table-cell changes when the anchor is absent even if stale path exists", () => {
    const initial = createState("| A | B |\n| - | - |\n| one | two |\n");
    const next = createState("| A | B |\n| - | - |\n| stale | occupant |\n");
    const active = resolveChangeForState(
      initial,
      changeAt(
        diff("| A | B |\n| - | - |\n| one | old |\n", "| A | B |\n| - | - |\n| one | two |\n"),
        "root.0.rows.1.cells.1",
      ),
    );

    expect(acknowledgeUnacknowledgedDocumentChanges([active], next, { retarget: true })).toEqual(
      [],
    );
  });

  test("retargets active table-cell changes when a local edit shifts cell paths", () => {
    const initial = createState("| A | B |\n| - | - |\n| one | two |\n");
    const cell = indexedTextEntries(initial).find((path) => path.text === "two");
    const locallyEdited = createState("| A | B |\n| - | - |\n| new | row |\n| one | two |\n");
    const shiftedCell = indexedTextEntries(locallyEdited).find((path) => path.text === "two");

    if (!cell || !shiftedCell) {
      throw new Error("Expected table cell paths");
    }

    const active = resolveChangeForState(
      initial,
      changeAt(
        diff("| A | B |\n| - | - |\n| one | old |\n", "| A | B |\n| - | - |\n| one | two |\n"),
        "root.0.rows.1.cells.1",
      ),
    );

    expect(mergeUnacknowledgedDocumentChanges([active], [], locallyEdited)).toEqual({
      newChanges: [],
      changes: [
        expect.objectContaining({
          change: expect.objectContaining({
            kind: "modified",
            anchor: expect.objectContaining({
              kind: "table-cell",
              path: "root.0.rows.2.cells.1",
            }),
          }),
          editorTarget: expect.objectContaining({
            kind: "table-cell",
            path: "root.0.rows.2.cells.1",
          }),
          changeKey: active.changeKey,
        }),
      ],
    });
  });

  test("keeps added block changes added when the same external snapshot shifts and edits them", () => {
    const initial = createState("Alpha\n");
    let nextState = createState("Intro\n\nAlpha updated\n\nOther\n");
    const otherPath = indexedTextEntries(nextState)[2];
    if (!otherPath) {
      throw new Error("Expected other path");
    }
    nextState = setSelection(nextState, {
      path: otherPath.path,
      offset: 0,
    });
    const active = resolveChangeForState(initial, changeAt(diff("", "Alpha\n"), "root.0"));
    const incoming = diff("Alpha\n", "Intro\n\nAlpha updated\n\nOther\n");
    const next = mergeUnacknowledgedDocumentChanges([active], incoming, nextState);

    expect(next.changes).toHaveLength(2);
    expect(next.changes.map((change) => change.change.kind)).toEqual(["added", "added"]);
    expect(next.changes.map((change) => change.change.anchor.path).sort()).toEqual([
      "root.0",
      "root.1",
    ]);
    expect(next.changes.find((change) => change.change.anchor.path === "root.1")).toMatchObject({
      change: {
        kind: "added",
        anchor: expect.objectContaining({
          kind: "block",
          path: "root.1",
        }),
      },
    });
    expect(next.newChanges).toEqual([
      expect.objectContaining({
        change: expect.objectContaining({
          anchor: expect.objectContaining({
            path: "root.0",
          }),
        }),
      }),
    ]);
  });

  test("keeps added block changes added after multiple inserted blocks before the edit", () => {
    const initial = createState("Alpha\n");
    let nextState = createState("Intro 1\n\nIntro 2\n\nAlpha updated\n\nOther\n");
    const otherPath = indexedTextEntries(nextState)[3];
    if (!otherPath) {
      throw new Error("Expected other path");
    }
    nextState = setSelection(nextState, {
      path: otherPath.path,
      offset: 0,
    });
    const active = resolveChangeForState(initial, changeAt(diff("", "Alpha\n"), "root.0"));
    const incoming = diff("Alpha\n", "Intro 1\n\nIntro 2\n\nAlpha updated\n\nOther\n");
    const next = mergeUnacknowledgedDocumentChanges([active], incoming, nextState);

    expect(next.changes).toHaveLength(3);
    expect(next.changes.map((change) => change.change.kind)).toEqual([
      "added",
      "added",
      "added",
    ]);
    expect(next.changes.map((change) => change.change.anchor.path).sort()).toEqual([
      "root.0",
      "root.1",
      "root.2",
    ]);
    expect(next.changes.find((change) => change.change.anchor.path === "root.2")).toMatchObject({
      change: {
        kind: "added",
        anchor: expect.objectContaining({
          kind: "block",
          path: "root.2",
        }),
      },
    });
    expect(next.newChanges.map((change) => change.change.anchor.path).sort()).toEqual([
      "root.0",
      "root.1",
    ]);
  });

  test("keeps added table-cell changes added when the same external snapshot shifts and edits them", () => {
    const initial = createState("| A | B |\n| - | - |\n| one | new |\n");
    let nextState = createState(
      "| A | B |\n| - | - |\n| inserted | row |\n| one | changed |\n\nOther\n",
    );
    const otherPath = indexedTextEntries(nextState).find((path) => path.text === "Other");
    if (!otherPath) {
      throw new Error("Expected other path");
    }
    nextState = setSelection(nextState, {
      path: otherPath.path,
      offset: 0,
    });

    const active = resolveChangeForState(
      initial,
      changeAt(
        diff("| A |\n| - |\n| one |\n", "| A | B |\n| - | - |\n| one | new |\n"),
        "root.0.rows.1.cells.1",
      ),
    );
    const incoming = diff(
      "| A | B |\n| - | - |\n| one | new |\n",
      "| A | B |\n| - | - |\n| inserted | row |\n| one | changed |\n\nOther\n",
    );
    const next = mergeUnacknowledgedDocumentChanges([active], incoming, nextState);

    expect(next.changes).toHaveLength(3);
    expect(next.changes.map((change) => change.change.kind)).toEqual([
      "added",
      "added",
      "added",
    ]);
    expect(next.changes.map((change) => change.change.anchor.path).sort()).toEqual([
      "root.0.rows.1.cells.0",
      "root.0.rows.1.cells.1",
      "root.0.rows.2.cells.1",
    ]);
    expect(
      next.changes.find((change) => change.change.anchor.path === "root.0.rows.2.cells.1"),
    ).toMatchObject({
      change: {
        kind: "added",
        anchor: expect.objectContaining({
          kind: "table-cell",
          path: "root.0.rows.2.cells.1",
        }),
      },
    });
    expect(next.newChanges.map((change) => change.change.anchor.path).sort()).toEqual([
      "root.0.rows.1.cells.0",
      "root.0.rows.1.cells.1",
    ]);
  });

  test("does not preserve added when only the path matches", () => {
    const activeState = createState("Alpha\n");
    let nextState = createState("Gamma\n\nOther\n");
    const otherPath = indexedTextEntries(nextState)[1];
    if (!otherPath) {
      throw new Error("Expected other path");
    }
    nextState = setSelection(nextState, {
      path: otherPath.path,
      offset: 0,
    });
    const active = resolveChangeForState(activeState, changeAt(diff("", "Alpha\n"), "root.0"));
    const incoming = changeAt(diff("Beta\n\nOther\n", "Gamma\n\nOther\n"), "root.0");
    const next = mergeUnacknowledgedDocumentChanges([active], [incoming], nextState);

    expect(next.changes).toHaveLength(1);
    expect(next.changes[0]!.change.kind).toBe("modified");
    expect(next.newChanges).toEqual(next.changes);
  });
});

function diff(previousMarkdown: string, nextMarkdown: string) {
  return findDocumentChanges(parseDocument(previousMarkdown), parseDocument(nextMarkdown));
}

function changeAt(changes: readonly DocumentChange[], path: string) {
  const change = changes.find((candidate) => candidate.anchor.path === path);

  if (!change) {
    throw new Error(`Expected document change at ${path}`);
  }

  return change;
}

function resolveChangeForState(
  state: ReturnType<typeof createState>,
  change: DocumentChange,
): UnacknowledgedDocumentChange {
  const changeKey = documentNodeAnchorKey(change.anchor);

  if (change.anchor.kind === "block") {
    return {
      change,
      editorTarget: {
        path: change.anchor.path,
        kind: "block",
      },
      changeKey,
    };
  }

  const path = indexedTextEntries(state).find(
    (candidate) => candidate.path === change.anchor.path,
  );
  if (!path) {
    throw new Error(`Expected path at ${change.anchor.path}`);
  }
  return {
    change,
    editorTarget: {
      kind: "table-cell",
      path: path.path,
    },
    changeKey,
  };
}

function createState(markdown: string) {
  return createEditorState(parseDocument(markdown));
}

function createTable(rowCount: number) {
  const rows = Array.from({ length: rowCount }, (_, index) => `| row ${index} | value ${index} |`);
  return ["| A | B |", "| - | - |", ...rows].join("\n") + "\n";
}
