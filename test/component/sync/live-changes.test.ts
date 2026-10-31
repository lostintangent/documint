import { indexedTextEntries, setup } from "@test/editor/helpers";
import { describe, expect, test } from "bun:test";
import {
  acknowledgeUnacknowledgedDocumentChanges,
  mergeUnacknowledgedDocumentChanges,
  type UnacknowledgedDocumentChange,
} from "@/component/sync/live-changes";
import { documentNodeAnchorKey, findDocumentChanges, type DocumentChange } from "@/document";
import { setSelection } from "@/editor/state";
import { parseDocument } from "@/markdown";

describe("unacknowledged document changes", () => {
  test("merges targets, consumes repeated targets, and reports only new fade targets", () => {
    let state = setup("Alpha\n\nBeta\n\nGamma\n");
    const third = indexedTextEntries(state)[2];

    if (!third) {
      throw new Error("Expected three paths");
    }

    state = setSelection(state, { path: third.path, offset: 0 });
    const current = [
      unacknowledgedChange(
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

    expect(next.changes.map((change) => change.kind)).toEqual(["modified", "modified"]);
    expect(next.newChanges).toEqual([next.changes[1]]);
  });

  test("keeps unacknowledged added blocks added when later external snapshots modify them", () => {
    let state = setup("Alpha updated\n\nOther\n");
    const otherPath = indexedTextEntries(state)[1];

    if (!otherPath) {
      throw new Error("Expected paths");
    }

    state = setSelection(state, { path: otherPath.path, offset: 0 });

    const current = unacknowledgedChange(changeAt(diff("Other\n", "Alpha\n\nOther\n"), "root.0"));
    const incoming = changeAt(diff("Alpha\n\nOther\n", "Alpha updated\n\nOther\n"), "root.0");
    const next = mergeUnacknowledgedDocumentChanges([current], [incoming], state);

    expect(next.changes).toHaveLength(1);
    expect(next.changes[0]).toMatchObject({
      kind: "added",
      anchor: incoming.anchor,
    });
    expect(next.newChanges).toEqual([]);
  });

  test("keeps unacknowledged added table cells added when later external snapshots modify them", () => {
    const state = setup("| A | B |\n| - | - |\n| one | changed |\n");

    const current = unacknowledgedChange(
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
    expect(next.changes[0]).toMatchObject({
      kind: "added",
      anchor: incoming.anchor,
    });
    expect(next.newChanges).toEqual([]);
  });

  test("refreshes unacknowledged modified blocks without reporting a new fade target", () => {
    let state = setup("Alpine\n\nOther\n");
    const otherPath = indexedTextEntries(state)[1];

    if (!otherPath) {
      throw new Error("Expected paths");
    }

    state = setSelection(state, { path: otherPath.path, offset: 0 });

    const current = unacknowledgedChange(
      changeAt(diff("Old\n\nOther\n", "Alpha\n\nOther\n"), "root.0"),
    );
    if (current.kind !== "modified") {
      throw new Error("Expected current modified change");
    }
    const incoming = changeAt(diff("Alpha\n\nOther\n", "Alpine\n\nOther\n"), "root.0");
    const next = mergeUnacknowledgedDocumentChanges([current], [incoming], state);

    expect(next.changes).toHaveLength(1);
    expect(next.changes[0]).toMatchObject({
      kind: "modified",
      previousAnchor: current.previousAnchor,
      anchor: incoming.anchor,
    });
    expect(next.newChanges).toEqual([]);
  });

  test("does not add changes for the current selection target", () => {
    const state = setup("Alpha\n");
    const path = indexedTextEntries(state)[0];

    if (!path) {
      throw new Error("Expected path");
    }

    expect(
      mergeUnacknowledgedDocumentChanges([], [changeAt(diff("Old\n", "Alpha\n"), "root.0")], state),
    ).toEqual({ newChanges: [], changes: [] });
  });

  test("keeps fresh modified block changes when the new content is duplicated", () => {
    let state = setup("Same\n\nSame\n");
    const secondPath = indexedTextEntries(state)[1];

    if (!secondPath) {
      throw new Error("Expected second path");
    }

    state = setSelection(state, { path: secondPath.path, offset: 0 });
    const incoming = changeAt(diff("Old\n\nSame\n", "Same\n\nSame\n"), "root.0");
    const next = mergeUnacknowledgedDocumentChanges([], [incoming], state);

    expect(next.changes).toHaveLength(1);
    expect(next.changes[0]).toMatchObject(incoming);
    expect(next.newChanges).toEqual(next.changes);
  });

  test("keeps fresh modified table-cell changes when the new content is duplicated", () => {
    let state = setup("| A | B |\n| - | - |\n| same | same |\n");
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
    expect(next.changes[0]).toMatchObject(incoming);
    expect(next.newChanges).toEqual(next.changes);
  });

  test("retargets existing changes when a later external snapshot has no targetable changes", () => {
    const initial = setup("Alpha\n\nBeta\n");
    const beta = indexedTextEntries(initial).find((path) => path.text === "Beta");
    const next = setup("Intro\n\nAlpha\n\nBeta\n");
    const shiftedBeta = indexedTextEntries(next).find((path) => path.text === "Beta");

    if (!beta || !shiftedBeta) {
      throw new Error("Expected beta paths");
    }

    const active = unacknowledgedChange(
      changeAt(diff("Alpha\n\nOld\n", "Alpha\n\nBeta\n"), "root.1"),
    );

    expect(mergeUnacknowledgedDocumentChanges([active], [], next)).toEqual({
      newChanges: [],
      changes: [
        expect.objectContaining({
          kind: "modified",
          anchor: expect.objectContaining({
            kind: "block",
            path: "root.2",
          }),
          changeKey: active.changeKey,
        }),
      ],
    });
  });

  test("retargets active changes when an external insert shifts block paths", () => {
    const initial = setup("Alpha\n\nBeta\n");
    const beta = indexedTextEntries(initial).find((path) => path.text === "Beta");
    const next = setup("Intro\n\nAlpha\n\nBeta\n");
    const shiftedBeta = indexedTextEntries(next).find((path) => path.text === "Beta");

    if (!beta || !shiftedBeta) {
      throw new Error("Expected beta paths");
    }

    const active = unacknowledgedChange(
      changeAt(diff("Alpha\n\nOld\n", "Alpha\n\nBeta\n"), "root.1"),
    );

    expect(mergeUnacknowledgedDocumentChanges([active], [], next)).toEqual({
      newChanges: [],
      changes: [
        expect.objectContaining({
          kind: "modified",
          anchor: expect.objectContaining({
            kind: "block",
            path: "root.2",
          }),
          changeKey: active.changeKey,
        }),
      ],
    });
  });

  test("acknowledges after retargeting instead of dismissing selected stale block paths", () => {
    let next = setup("Stale occupant\n\nAlpha\n\nBeta\n");
    const stalePath = indexedTextEntries(next).find((path) => path.text === "Alpha");

    if (!stalePath) {
      throw new Error("Expected stale path path");
    }

    next = setSelection(next, { path: stalePath.path, offset: 0 });
    const active = unacknowledgedChange(
      changeAt(diff("Alpha\n\nOld\n", "Alpha\n\nBeta\n"), "root.1"),
    );

    expect(acknowledgeUnacknowledgedDocumentChanges([active], next, { retarget: true })).toEqual([
      expect.objectContaining({
        anchor: expect.objectContaining({
          path: "root.2",
          kind: "block",
        }),
      }),
    ]);
  });

  test("drops active changes when the anchor is absent even if the stale block path exists", () => {
    const next = setup("Alpha\n\nStale occupant\n");
    const active = unacknowledgedChange(
      changeAt(diff("Alpha\n\nOld\n", "Alpha\n\nBeta\n"), "root.1"),
    );

    expect(acknowledgeUnacknowledgedDocumentChanges([active], next, { retarget: true })).toEqual(
      [],
    );
  });

  test("retargets active table-cell changes when an external row insert shifts cell paths", () => {
    const initial = setup("| A | B |\n| - | - |\n| one | two |\n");
    const cell = indexedTextEntries(initial).find((path) => path.text === "two");
    const next = setup("| A | B |\n| - | - |\n| new | row |\n| one | two |\n");
    const shiftedCell = indexedTextEntries(next).find((path) => path.text === "two");

    if (!cell || !shiftedCell) {
      throw new Error("Expected table cell paths");
    }

    const active = unacknowledgedChange(
      changeAt(
        diff("| A | B |\n| - | - |\n| one | old |\n", "| A | B |\n| - | - |\n| one | two |\n"),
        "root.0.rows.1.cells.1",
      ),
    );

    expect(mergeUnacknowledgedDocumentChanges([active], [], next)).toEqual({
      newChanges: [],
      changes: [
        expect.objectContaining({
          kind: "modified",
          anchor: expect.objectContaining({
            kind: "table-cell",
            path: "root.0.rows.2.cells.1",
          }),
          changeKey: active.changeKey,
        }),
      ],
    });
  });

  test("acknowledges after retargeting instead of dismissing selected stale table-cell paths", () => {
    let next = setup("| A | B |\n| - | - |\n| stale | occupant |\n| one | two |\n");
    const staleCell = indexedTextEntries(next).find(
      (path) => path.path === "root.0.rows.1.cells.1",
    );

    if (!staleCell) {
      throw new Error("Expected stale path table cell");
    }

    next = setSelection(next, { path: staleCell.path, offset: 0 });
    const active = unacknowledgedChange(
      changeAt(
        diff("| A | B |\n| - | - |\n| one | old |\n", "| A | B |\n| - | - |\n| one | two |\n"),
        "root.0.rows.1.cells.1",
      ),
    );

    expect(acknowledgeUnacknowledgedDocumentChanges([active], next, { retarget: true })).toEqual([
      expect.objectContaining({
        anchor: expect.objectContaining({
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
    let next = setup(
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
    const droppedPath = indexedTextEntries(next).find((path) => path.text === "Drop");

    if (!droppedPath) {
      throw new Error("Expected dropped path");
    }

    next = setSelection(next, {
      path: droppedPath.path,
      offset: 0,
    });

    const dropped = unacknowledgedChange(
      changeAt(diff(initialMarkdown.replace("Drop", "Old drop"), initialMarkdown), "root.0"),
    );
    const retargeted = unacknowledgedChange(
      changeAt(
        diff(initialMarkdown.replace("two", "old"), initialMarkdown),
        "root.1.rows.1.cells.1",
      ),
    );
    const retained = unacknowledgedChange(
      changeAt(diff(initialMarkdown.replace("Keep", "Old keep"), initialMarkdown), "root.2"),
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
    expect(acknowledged.map((change) => change.anchor.path)).toEqual([
      "root.1.rows.2.cells.1",
      "root.2",
    ]);
  });

  test("drops active table-cell changes when the anchor is absent even if stale path exists", () => {
    const next = setup("| A | B |\n| - | - |\n| stale | occupant |\n");
    const active = unacknowledgedChange(
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
    const initial = setup("| A | B |\n| - | - |\n| one | two |\n");
    const cell = indexedTextEntries(initial).find((path) => path.text === "two");
    const locallyEdited = setup("| A | B |\n| - | - |\n| new | row |\n| one | two |\n");
    const shiftedCell = indexedTextEntries(locallyEdited).find((path) => path.text === "two");

    if (!cell || !shiftedCell) {
      throw new Error("Expected table cell paths");
    }

    const active = unacknowledgedChange(
      changeAt(
        diff("| A | B |\n| - | - |\n| one | old |\n", "| A | B |\n| - | - |\n| one | two |\n"),
        "root.0.rows.1.cells.1",
      ),
    );

    expect(mergeUnacknowledgedDocumentChanges([active], [], locallyEdited)).toEqual({
      newChanges: [],
      changes: [
        expect.objectContaining({
          kind: "modified",
          anchor: expect.objectContaining({
            kind: "table-cell",
            path: "root.0.rows.2.cells.1",
          }),
          changeKey: active.changeKey,
        }),
      ],
    });
  });

  test("keeps added block changes added when the same external snapshot shifts and edits them", () => {
    let nextState = setup("Intro\n\nAlpha updated\n\nOther\n");
    const otherPath = indexedTextEntries(nextState)[2];
    if (!otherPath) {
      throw new Error("Expected other path");
    }
    nextState = setSelection(nextState, {
      path: otherPath.path,
      offset: 0,
    });
    const active = unacknowledgedChange(changeAt(diff("", "Alpha\n"), "root.0"));
    const incoming = diff("Alpha\n", "Intro\n\nAlpha updated\n\nOther\n");
    const next = mergeUnacknowledgedDocumentChanges([active], incoming, nextState);

    expect(next.changes).toHaveLength(2);
    expect(next.changes.map((change) => change.kind)).toEqual(["added", "added"]);
    expect(next.changes.map((change) => change.anchor.path).sort()).toEqual(["root.0", "root.1"]);
    expect(next.changes.find((change) => change.anchor.path === "root.1")).toMatchObject({
      kind: "added",
      anchor: expect.objectContaining({
        kind: "block",
        path: "root.1",
      }),
    });
    expect(next.newChanges).toEqual([
      expect.objectContaining({
        anchor: expect.objectContaining({
          path: "root.0",
        }),
      }),
    ]);
  });

  test("keeps added block changes added after multiple inserted blocks before the edit", () => {
    let nextState = setup("Intro 1\n\nIntro 2\n\nAlpha updated\n\nOther\n");
    const otherPath = indexedTextEntries(nextState)[3];
    if (!otherPath) {
      throw new Error("Expected other path");
    }
    nextState = setSelection(nextState, {
      path: otherPath.path,
      offset: 0,
    });
    const active = unacknowledgedChange(changeAt(diff("", "Alpha\n"), "root.0"));
    const incoming = diff("Alpha\n", "Intro 1\n\nIntro 2\n\nAlpha updated\n\nOther\n");
    const next = mergeUnacknowledgedDocumentChanges([active], incoming, nextState);

    expect(next.changes).toHaveLength(3);
    expect(next.changes.map((change) => change.kind)).toEqual(["added", "added", "added"]);
    expect(next.changes.map((change) => change.anchor.path).sort()).toEqual([
      "root.0",
      "root.1",
      "root.2",
    ]);
    expect(next.changes.find((change) => change.anchor.path === "root.2")).toMatchObject({
      kind: "added",
      anchor: expect.objectContaining({
        kind: "block",
        path: "root.2",
      }),
    });
    expect(next.newChanges.map((change) => change.anchor.path).sort()).toEqual([
      "root.0",
      "root.1",
    ]);
  });

  test("keeps added table-cell changes added when the same external snapshot shifts and edits them", () => {
    let nextState = setup("| A | B |\n| - | - |\n| inserted | row |\n| one | changed |\n\nOther\n");
    const otherPath = indexedTextEntries(nextState).find((path) => path.text === "Other");
    if (!otherPath) {
      throw new Error("Expected other path");
    }
    nextState = setSelection(nextState, {
      path: otherPath.path,
      offset: 0,
    });

    const active = unacknowledgedChange(
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
    expect(next.changes.map((change) => change.kind)).toEqual(["added", "added", "added"]);
    expect(next.changes.map((change) => change.anchor.path).sort()).toEqual([
      "root.0.rows.1.cells.0",
      "root.0.rows.1.cells.1",
      "root.0.rows.2.cells.1",
    ]);
    expect(
      next.changes.find((change) => change.anchor.path === "root.0.rows.2.cells.1"),
    ).toMatchObject({
      kind: "added",
      anchor: expect.objectContaining({
        kind: "table-cell",
        path: "root.0.rows.2.cells.1",
      }),
    });
    expect(next.newChanges.map((change) => change.anchor.path).sort()).toEqual([
      "root.0.rows.1.cells.0",
      "root.0.rows.1.cells.1",
    ]);
  });

  test("does not preserve added when only the path matches", () => {
    let nextState = setup("Gamma\n\nOther\n");
    const otherPath = indexedTextEntries(nextState)[1];
    if (!otherPath) {
      throw new Error("Expected other path");
    }
    nextState = setSelection(nextState, {
      path: otherPath.path,
      offset: 0,
    });
    const active = unacknowledgedChange(changeAt(diff("", "Alpha\n"), "root.0"));
    const incoming = changeAt(diff("Beta\n\nOther\n", "Gamma\n\nOther\n"), "root.0");
    const next = mergeUnacknowledgedDocumentChanges([active], [incoming], nextState);

    expect(next.changes).toHaveLength(1);
    expect(next.changes[0]!.kind).toBe("modified");
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

function unacknowledgedChange(change: DocumentChange): UnacknowledgedDocumentChange {
  return {
    ...change,
    changeKey: documentNodeAnchorKey(change.anchor),
  };
}
