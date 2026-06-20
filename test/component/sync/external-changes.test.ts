import { describe, expect, test } from "bun:test";
import {
  mergeUnacknowledgedDocumentChanges,
  type UnacknowledgedDocumentChange,
} from "@/component/sync/external-changes";
import { findDocumentChanges, type DocumentChange } from "@/document";
import { createEditorState, setSelection } from "@/editor/state";
import { parseDocument } from "@/markdown";

describe("external change targets", () => {
  test("detects modified text roots", () => {
    const nextState = createState("Alpine\n");
    const targets = diff("Alpha\n", "Alpine\n");

    expect(targets).toEqual([
      expect.objectContaining({
        changeKind: "modified",
        target: expect.objectContaining({
          node: expect.objectContaining({
            blockId: nextState.documentIndex.regions[0]!.block.id,
            path: "root.0",
          }),
          kind: "block",
        }),
      }),
    ]);
  });

  test("classifies inserted roots as added without marking shifted suffixes", () => {
    const nextState = createState("Intro\n\nAlpha\n\nBeta\n");
    const targets = diff("Alpha\n\nBeta\n", "Intro\n\nAlpha\n\nBeta\n");

    expect(targets).toHaveLength(1);
    expect(targets[0]).toMatchObject({
      changeKind: "added",
      target: {
        node: expect.objectContaining({
          blockId: nextState.documentIndex.regions[0]!.block.id,
          path: "root.0",
        }),
        kind: "block",
      },
    });
  });

  test("detects checkbox changes at list-item granularity", () => {
    const targets = diff("- [ ] task\n", "- [x] task\n");

    expect(targets).toHaveLength(1);
    expect(targets[0]).toMatchObject({
      changeKind: "modified",
      target: { kind: "block" },
    });
  });

  test("detects changed table cells", () => {
    const nextState = createState("| A | B |\n| - | - |\n| one | three |\n");
    const targets = diff(
      "| A | B |\n| - | - |\n| one | two |\n",
      "| A | B |\n| - | - |\n| one | three |\n",
    );
    const changedCell = nextState.documentIndex.regions.find(
      (region) => region.text === "three",
    );

    expect(targets).toHaveLength(1);
    expect(changedCell).toBeDefined();
    expect(targets[0]).toMatchObject({
      changeKind: "modified",
      target: {
        node: expect.objectContaining({
          path: changedCell!.path,
        }),
        kind: "table-cell",
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
          changeKind: "added",
          target: expect.objectContaining({ kind: "table-cell" }),
        }),
      ]),
    );
    expect(targets.every((target) => target.changeKind === "added")).toBe(true);
  });

  test("classifies inserted rows before modified rows in the same snapshot", () => {
    const targets = diff(
      "| A | B |\n| - | - |\n| one | two |\n| three | four |\n",
      "| A | B |\n| - | - |\n| new | row |\n| one | two updated |\n| three | four |\n",
    );

    expect(targets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          changeKind: "modified",
          target: expect.objectContaining({
            node: expect.objectContaining({
              path: "root.0.rows.2.cells.1",
            }),
            kind: "table-cell",
          }),
        }),
        expect.objectContaining({
          changeKind: "added",
          target: expect.objectContaining({
            node: expect.objectContaining({
              path: "root.0.rows.1.cells.0",
            }),
            kind: "table-cell",
          }),
        }),
        expect.objectContaining({
          changeKind: "added",
          target: expect.objectContaining({
            node: expect.objectContaining({
              path: "root.0.rows.1.cells.1",
            }),
            kind: "table-cell",
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
    expect(targets.every((target) => target.changeKind === "added")).toBe(true);
  });

  test("classifies inserted columns before modified cells in the same snapshot", () => {
    const targets = diff(
      "| A | B | C |\n| - | - | - |\n| one | two | three |\n",
      "| A | New | B | C |\n| - | - | - | - |\n| one | inserted | two changed | three |\n",
    );

    expect(targets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          changeKind: "modified",
          target: expect.objectContaining({
            node: expect.objectContaining({
              path: "root.0.rows.1.cells.2",
            }),
            kind: "table-cell",
          }),
        }),
        expect.objectContaining({
          changeKind: "added",
          target: expect.objectContaining({
            node: expect.objectContaining({
              path: "root.0.rows.0.cells.1",
            }),
            kind: "table-cell",
          }),
        }),
        expect.objectContaining({
          changeKind: "added",
          target: expect.objectContaining({
            node: expect.objectContaining({
              path: "root.0.rows.1.cells.1",
            }),
            kind: "table-cell",
          }),
        }),
      ]),
    );
    expect(targets).toHaveLength(3);
  });

  test("returns no new changes for noisy broad rewrites", () => {
    const previous = Array.from(
      { length: 12 },
      (_, index) => `Old ${index}`,
    ).join("\n\n");
    const next = Array.from({ length: 12 }, (_, index) => `New ${index}`).join(
      "\n\n",
    );

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
    const third = state.documentIndex.regions[2];

    if (!third) {
      throw new Error("Expected three regions");
    }

    state = setSelection(state, { regionId: third.id, offset: 0 });
    const current = [
      resolveChangeForState(
        state,
        changeAt(
          diff("Old\n\nBeta\n\nGamma\n", "Alpha\n\nBeta\n\nGamma\n"),
          "root.0",
        ),
      ),
    ];
    const next = mergeUnacknowledgedDocumentChanges(
      current,
      [
        changeAt(diff("Beta\n\nGamma\n", "Alpha\n\nBeta\n\nGamma\n"), "root.0"),
        changeAt(
          diff("Alpha\n\nOld\n\nGamma\n", "Alpha\n\nBeta\n\nGamma\n"),
          "root.1",
        ),
      ],
      state,
    );

    expect(next.changes.map((change) => change.change.changeKind)).toEqual([
      "modified",
      "modified",
    ]);
    expect(next.newChanges).toEqual([next.changes[1]]);
  });

  test("keeps unacknowledged added blocks added when later external snapshots modify them", () => {
    const initialState = createState("Alpha\n\nOther\n");
    let state = createState("Alpha updated\n\nOther\n");
    const otherRegion = state.documentIndex.regions[1];

    if (!otherRegion) {
      throw new Error("Expected regions");
    }

    state = setSelection(state, { regionId: otherRegion.id, offset: 0 });

    const current = resolveChangeForState(
      initialState,
      changeAt(diff("Other\n", "Alpha\n\nOther\n"), "root.0"),
    );
    const incoming = changeAt(
      diff("Alpha\n\nOther\n", "Alpha updated\n\nOther\n"),
      "root.0",
    );
    const next = mergeUnacknowledgedDocumentChanges(
      [current],
      [incoming],
      state,
    );

    expect(next.changes).toHaveLength(1);
    expect(next.changes[0]!.change).toMatchObject({
      changeKind: "added",
      target: incoming.target,
    });
    expect(next.newChanges).toEqual([]);
  });

  test("keeps unacknowledged added table cells added when later external snapshots modify them", () => {
    const initialState = createState("| A | B |\n| - | - |\n| one | new |\n");
    const state = createState("| A | B |\n| - | - |\n| one | changed |\n");

    const current = resolveChangeForState(
      initialState,
      changeAt(
        diff(
          "| A |\n| - |\n| one |\n",
          "| A | B |\n| - | - |\n| one | new |\n",
        ),
        "root.0.rows.1.cells.1",
      ),
    );
    const incoming = changeAt(
      diff(
        "| A | B |\n| - | - |\n| one | new |\n",
        "| A | B |\n| - | - |\n| one | changed |\n",
      ),
      "root.0.rows.1.cells.1",
    );
    const next = mergeUnacknowledgedDocumentChanges(
      [current],
      [incoming],
      state,
    );

    expect(next.changes).toHaveLength(1);
    expect(next.changes[0]!.change).toMatchObject({
      changeKind: "added",
      target: incoming.target,
    });
    expect(next.newChanges).toEqual([]);
  });

  test("refreshes unacknowledged modified blocks without reporting a new fade target", () => {
    const initialState = createState("Alpha\n\nOther\n");
    let state = createState("Alpine\n\nOther\n");
    const otherRegion = state.documentIndex.regions[1];

    if (!otherRegion) {
      throw new Error("Expected regions");
    }

    state = setSelection(state, { regionId: otherRegion.id, offset: 0 });

    const current = resolveChangeForState(
      initialState,
      changeAt(diff("Old\n\nOther\n", "Alpha\n\nOther\n"), "root.0"),
    );
    if (current.change.changeKind !== "modified") {
      throw new Error("Expected current modified change");
    }
    const incoming = changeAt(
      diff("Alpha\n\nOther\n", "Alpine\n\nOther\n"),
      "root.0",
    );
    const next = mergeUnacknowledgedDocumentChanges(
      [current],
      [incoming],
      state,
    );

    expect(next.changes).toHaveLength(1);
    expect(next.changes[0]!.change).toMatchObject({
      changeKind: "modified",
      previousTarget: current.change.previousTarget,
      target: incoming.target,
    });
    expect(next.newChanges).toEqual([]);
  });

  test("does not add changes for the current selection target", () => {
    const state = createState("Alpha\n");
    const region = state.documentIndex.regions[0];

    if (!region) {
      throw new Error("Expected region");
    }

    expect(
      mergeUnacknowledgedDocumentChanges(
        [],
        [changeAt(diff("Old\n", "Alpha\n"), "root.0")],
        state,
      ),
    ).toEqual({ newChanges: [], changes: [] });
  });

  test("keeps fresh modified block changes when the new content is duplicated", () => {
    let state = createState("Same\n\nSame\n");
    const secondRegion = state.documentIndex.regions[1];

    if (!secondRegion) {
      throw new Error("Expected second region");
    }

    state = setSelection(state, { regionId: secondRegion.id, offset: 0 });
    const incoming = changeAt(
      diff("Old\n\nSame\n", "Same\n\nSame\n"),
      "root.0",
    );
    const next = mergeUnacknowledgedDocumentChanges([], [incoming], state);

    expect(next.changes).toHaveLength(1);
    expect(next.changes[0]!.change).toBe(incoming);
    expect(next.newChanges).toEqual(next.changes);
  });

  test("keeps fresh modified table-cell changes when the new content is duplicated", () => {
    let state = createState("| A | B |\n| - | - |\n| same | same |\n");
    const secondCell = state.documentIndex.regions.find(
      (region) => region.path === "root.0.rows.1.cells.1",
    );

    if (!secondCell) {
      throw new Error("Expected second table cell");
    }

    state = setSelection(state, { regionId: secondCell.id, offset: 0 });
    const incoming = changeAt(
      diff(
        "| A | B |\n| - | - |\n| old | same |\n",
        "| A | B |\n| - | - |\n| same | same |\n",
      ),
      "root.0.rows.1.cells.0",
    );
    const next = mergeUnacknowledgedDocumentChanges([], [incoming], state);

    expect(next.changes).toHaveLength(1);
    expect(next.changes[0]!.change).toBe(incoming);
    expect(next.newChanges).toEqual(next.changes);
  });

  test("retargets existing changes when a later external snapshot has no targetable changes", () => {
    const initial = createState("Alpha\n\nBeta\n");
    const beta = initial.documentIndex.regions.find(
      (region) => region.text === "Beta",
    );
    const next = createState("Intro\n\nAlpha\n\nBeta\n");
    const shiftedBeta = next.documentIndex.regions.find(
      (region) => region.text === "Beta",
    );

    if (!beta || !shiftedBeta) {
      throw new Error("Expected beta regions");
    }

    expect(
      mergeUnacknowledgedDocumentChanges(
        [
          resolveChangeForState(
            initial,
            changeAt(diff("Alpha\n\nOld\n", "Alpha\n\nBeta\n"), "root.1"),
          ),
        ],
        [],
        next,
      ),
    ).toEqual({
      newChanges: [],
      changes: [
        {
          change: expect.objectContaining({
            changeKind: "modified",
            target: expect.objectContaining({
              node: expect.objectContaining({
                blockId: shiftedBeta.block.id,
                path: "root.2",
              }),
              kind: "block",
            }),
          }),
          editorTarget: {
            blockId: shiftedBeta.block.id,
            kind: "block",
          },
        },
      ],
    });
  });

  test("retargets active changes when an external insert shifts block paths", () => {
    const initial = createState("Alpha\n\nBeta\n");
    const beta = initial.documentIndex.regions.find(
      (region) => region.text === "Beta",
    );
    const next = createState("Intro\n\nAlpha\n\nBeta\n");
    const shiftedBeta = next.documentIndex.regions.find(
      (region) => region.text === "Beta",
    );

    if (!beta || !shiftedBeta) {
      throw new Error("Expected beta regions");
    }

    const active = resolveChangeForState(
      initial,
      changeAt(diff("Alpha\n\nOld\n", "Alpha\n\nBeta\n"), "root.1"),
    );

    expect(mergeUnacknowledgedDocumentChanges([active], [], next)).toEqual({
      newChanges: [],
      changes: [
        {
          change: expect.objectContaining({
            changeKind: "modified",
            target: expect.objectContaining({
              node: expect.objectContaining({
                blockId: shiftedBeta.block.id,
                path: "root.2",
              }),
              kind: "block",
            }),
          }),
          editorTarget: {
            blockId: shiftedBeta.block.id,
            kind: "block",
          },
        },
      ],
    });
  });

  test("retargets active table-cell changes when an external row insert shifts cell paths", () => {
    const initial = createState("| A | B |\n| - | - |\n| one | two |\n");
    const cell = initial.documentIndex.regions.find(
      (region) => region.text === "two",
    );
    const next = createState(
      "| A | B |\n| - | - |\n| new | row |\n| one | two |\n",
    );
    const shiftedCell = next.documentIndex.regions.find(
      (region) => region.text === "two",
    );

    if (!cell || !shiftedCell) {
      throw new Error("Expected table cell regions");
    }

    const active = resolveChangeForState(
      initial,
      changeAt(
        diff(
          "| A | B |\n| - | - |\n| one | old |\n",
          "| A | B |\n| - | - |\n| one | two |\n",
        ),
        "root.0.rows.1.cells.1",
      ),
    );

    expect(mergeUnacknowledgedDocumentChanges([active], [], next)).toEqual({
      newChanges: [],
      changes: [
        {
          change: expect.objectContaining({
            changeKind: "modified",
            target: expect.objectContaining({
              node: expect.objectContaining({
                path: "root.0.rows.2.cells.1",
              }),
              kind: "table-cell",
            }),
          }),
          editorTarget: {
            kind: "table-cell",
            regionId: shiftedCell.id,
          },
        },
      ],
    });
  });

  test("retargets active table-cell changes when a local edit shifts cell paths", () => {
    const initial = createState("| A | B |\n| - | - |\n| one | two |\n");
    const cell = initial.documentIndex.regions.find(
      (region) => region.text === "two",
    );
    const locallyEdited = createState(
      "| A | B |\n| - | - |\n| new | row |\n| one | two |\n",
    );
    const shiftedCell = locallyEdited.documentIndex.regions.find(
      (region) => region.text === "two",
    );

    if (!cell || !shiftedCell) {
      throw new Error("Expected table cell regions");
    }

    const active = resolveChangeForState(
      initial,
      changeAt(
        diff(
          "| A | B |\n| - | - |\n| one | old |\n",
          "| A | B |\n| - | - |\n| one | two |\n",
        ),
        "root.0.rows.1.cells.1",
      ),
    );

    expect(
      mergeUnacknowledgedDocumentChanges([active], [], locallyEdited),
    ).toEqual({
      newChanges: [],
      changes: [
        {
          change: expect.objectContaining({
            changeKind: "modified",
            target: expect.objectContaining({
              node: expect.objectContaining({
                path: "root.0.rows.2.cells.1",
              }),
              kind: "table-cell",
            }),
          }),
          editorTarget: {
            kind: "table-cell",
            regionId: shiftedCell.id,
          },
        },
      ],
    });
  });

  test("keeps added block changes added when the same external snapshot shifts and edits them", () => {
    const initial = createState("Alpha\n");
    let nextState = createState("Intro\n\nAlpha updated\n\nOther\n");
    const otherRegion = nextState.documentIndex.regions[2];
    if (!otherRegion) {
      throw new Error("Expected other region");
    }
    nextState = setSelection(nextState, {
      regionId: otherRegion.id,
      offset: 0,
    });
    const active = resolveChangeForState(
      initial,
      changeAt(diff("", "Alpha\n"), "root.0"),
    );
    const incoming = diff("Alpha\n", "Intro\n\nAlpha updated\n\nOther\n");
    const next = mergeUnacknowledgedDocumentChanges(
      [active],
      incoming,
      nextState,
    );

    expect(next.changes).toHaveLength(2);
    expect(next.changes.map((change) => change.change.changeKind)).toEqual([
      "added",
      "added",
    ]);
    expect(
      next.changes.map((change) => change.change.target.node.path).sort(),
    ).toEqual(["root.0", "root.1"]);
    expect(
      next.changes.find(
        (change) => change.change.target.node.path === "root.1",
      ),
    ).toMatchObject({
      change: {
        changeKind: "added",
        target: expect.objectContaining({
          node: expect.objectContaining({ path: "root.1" }),
          kind: "block",
        }),
      },
    });
    expect(next.newChanges).toEqual([
      expect.objectContaining({
        change: expect.objectContaining({
          target: expect.objectContaining({
            node: expect.objectContaining({ path: "root.0" }),
          }),
        }),
      }),
    ]);
  });

  test("keeps added block changes added after multiple inserted blocks before the edit", () => {
    const initial = createState("Alpha\n");
    let nextState = createState(
      "Intro 1\n\nIntro 2\n\nAlpha updated\n\nOther\n",
    );
    const otherRegion = nextState.documentIndex.regions[3];
    if (!otherRegion) {
      throw new Error("Expected other region");
    }
    nextState = setSelection(nextState, {
      regionId: otherRegion.id,
      offset: 0,
    });
    const active = resolveChangeForState(
      initial,
      changeAt(diff("", "Alpha\n"), "root.0"),
    );
    const incoming = diff(
      "Alpha\n",
      "Intro 1\n\nIntro 2\n\nAlpha updated\n\nOther\n",
    );
    const next = mergeUnacknowledgedDocumentChanges(
      [active],
      incoming,
      nextState,
    );

    expect(next.changes).toHaveLength(3);
    expect(next.changes.map((change) => change.change.changeKind)).toEqual([
      "added",
      "added",
      "added",
    ]);
    expect(
      next.changes.map((change) => change.change.target.node.path).sort(),
    ).toEqual(["root.0", "root.1", "root.2"]);
    expect(
      next.changes.find(
        (change) => change.change.target.node.path === "root.2",
      ),
    ).toMatchObject({
      change: {
        changeKind: "added",
        target: expect.objectContaining({
          node: expect.objectContaining({ path: "root.2" }),
          kind: "block",
        }),
      },
    });
    expect(
      next.newChanges.map((change) => change.change.target.node.path).sort(),
    ).toEqual(["root.0", "root.1"]);
  });

  test("keeps added table-cell changes added when the same external snapshot shifts and edits them", () => {
    const initial = createState("| A | B |\n| - | - |\n| one | new |\n");
    let nextState = createState(
      "| A | B |\n| - | - |\n| inserted | row |\n| one | changed |\n\nOther\n",
    );
    const otherRegion = nextState.documentIndex.regions.find(
      (region) => region.text === "Other",
    );
    if (!otherRegion) {
      throw new Error("Expected other region");
    }
    nextState = setSelection(nextState, {
      regionId: otherRegion.id,
      offset: 0,
    });

    const active = resolveChangeForState(
      initial,
      changeAt(
        diff(
          "| A |\n| - |\n| one |\n",
          "| A | B |\n| - | - |\n| one | new |\n",
        ),
        "root.0.rows.1.cells.1",
      ),
    );
    const incoming = diff(
      "| A | B |\n| - | - |\n| one | new |\n",
      "| A | B |\n| - | - |\n| inserted | row |\n| one | changed |\n\nOther\n",
    );
    const next = mergeUnacknowledgedDocumentChanges(
      [active],
      incoming,
      nextState,
    );

    expect(next.changes).toHaveLength(3);
    expect(next.changes.map((change) => change.change.changeKind)).toEqual([
      "added",
      "added",
      "added",
    ]);
    expect(
      next.changes.map((change) => change.change.target.node.path).sort(),
    ).toEqual([
      "root.0.rows.1.cells.0",
      "root.0.rows.1.cells.1",
      "root.0.rows.2.cells.1",
    ]);
    expect(
      next.changes.find(
        (change) => change.change.target.node.path === "root.0.rows.2.cells.1",
      ),
    ).toMatchObject({
      change: {
        changeKind: "added",
        target: expect.objectContaining({
          node: expect.objectContaining({
            path: "root.0.rows.2.cells.1",
          }),
          kind: "table-cell",
        }),
      },
    });
    expect(
      next.newChanges.map((change) => change.change.target.node.path).sort(),
    ).toEqual(["root.0.rows.1.cells.0", "root.0.rows.1.cells.1"]);
  });

  test("does not preserve added when only the path matches", () => {
    const activeState = createState("Alpha\n");
    let nextState = createState("Gamma\n\nOther\n");
    const otherRegion = nextState.documentIndex.regions[1];
    if (!otherRegion) {
      throw new Error("Expected other region");
    }
    nextState = setSelection(nextState, {
      regionId: otherRegion.id,
      offset: 0,
    });
    const active = resolveChangeForState(
      activeState,
      changeAt(diff("", "Alpha\n"), "root.0"),
    );
    const incoming = changeAt(
      diff("Beta\n\nOther\n", "Gamma\n\nOther\n"),
      "root.0",
    );
    const next = mergeUnacknowledgedDocumentChanges(
      [active],
      [incoming],
      nextState,
    );

    expect(next.changes).toHaveLength(1);
    expect(next.changes[0]!.change.changeKind).toBe("modified");
    expect(next.newChanges).toEqual(next.changes);
  });
});

function diff(previousMarkdown: string, nextMarkdown: string) {
  return findDocumentChanges(
    parseDocument(previousMarkdown),
    parseDocument(nextMarkdown),
  );
}

function changeAt(changes: readonly DocumentChange[], path: string) {
  const change = changes.find(
    (candidate) => candidate.target.node.path === path,
  );

  if (!change) {
    throw new Error(`Expected document change at ${path}`);
  }

  return change;
}

function resolveChangeForState(
  state: ReturnType<typeof createState>,
  change: DocumentChange,
): UnacknowledgedDocumentChange {
  if (change.target.kind === "block") {
    return {
      change,
      editorTarget: {
        blockId: change.target.node.blockId,
        kind: "block",
      },
    };
  }

  const region = state.documentIndex.regions.find(
    (candidate) => candidate.path === change.target.node.path,
  );
  if (!region) {
    throw new Error(`Expected region at ${change.target.node.path}`);
  }
  return {
    change,
    editorTarget: {
      kind: "table-cell",
      regionId: region.id,
    },
  };
}

function createState(markdown: string) {
  return createEditorState(parseDocument(markdown));
}

function createTable(rowCount: number) {
  const rows = Array.from(
    { length: rowCount },
    (_, index) => `| row ${index} | value ${index} |`,
  );
  return ["| A | B |", "| - | - |", ...rows].join("\n") + "\n";
}
