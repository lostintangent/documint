import { describe, expect, test } from "bun:test";
import {
  findDocumentChanges,
  retargetDocumentChanges,
  type DocumentChange,
} from "@/document";
import { parseDocument } from "@/markdown";

describe("document changes", () => {
  test("finds targeted block changes", () => {
    const next = parse("Alpine\n");
    const changes = findDocumentChanges(parse("Alpha\n"), next);

    expect(changes).toEqual([
      expect.objectContaining({
        changeKind: "modified",
        previousTarget: expect.objectContaining({
          node: expect.objectContaining({
            path: "root.0",
          }),
          kind: "block",
        }),
        target: expect.objectContaining({
          node: expect.objectContaining({
            blockId: next.blocks[0]!.id,
            path: "root.0",
          }),
          kind: "block",
        }),
      }),
    ]);
  });

  test("finds targeted table-cell changes", () => {
    const changes = findDocumentChanges(
      parse("| A | B |\n| - | - |\n| one | two |\n"),
      parse("| A | B |\n| - | - |\n| one | three |\n"),
    );

    expect(changes).toEqual([
      expect.objectContaining({
        changeKind: "modified",
        previousTarget: expect.objectContaining({
          node: expect.objectContaining({
            path: "root.0.rows.1.cells.1",
          }),
          kind: "table-cell",
        }),
        target: expect.objectContaining({
          node: expect.objectContaining({
            path: "root.0.rows.1.cells.1",
          }),
          kind: "table-cell",
        }),
      }),
    ]);
  });

  test("finds added table cells and shifted modified cells in the same row window", () => {
    const changes = findDocumentChanges(
      parse("| A | B |\n| - | - |\n| one | old |\n| two | stable |\n"),
      parse(
        "| A | B |\n| - | - |\n| new | row |\n| one | changed |\n| two | stable |\n",
      ),
    );

    expect(changes).toEqual(
      expect.arrayContaining([
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
        expect.objectContaining({
          changeKind: "modified",
          previousTarget: expect.objectContaining({
            node: expect.objectContaining({
              path: "root.0.rows.1.cells.1",
            }),
            kind: "table-cell",
          }),
          target: expect.objectContaining({
            node: expect.objectContaining({
              path: "root.0.rows.2.cells.1",
            }),
            kind: "table-cell",
          }),
        }),
      ]),
    );
  });

  test("finds added table columns and shifted modified cells in the same row", () => {
    const changes = findDocumentChanges(
      parse("| A | B | C |\n| - | - | - |\n| one | old | stable |\n"),
      parse(
        "| A | X | B | C |\n| - | - | - | - |\n| one | added | old changed | stable |\n",
      ),
    );

    expect(changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          changeKind: "added",
          target: expect.objectContaining({
            node: expect.objectContaining({
              path: "root.0.rows.1.cells.1",
            }),
            kind: "table-cell",
          }),
        }),
        expect.objectContaining({
          changeKind: "modified",
          previousTarget: expect.objectContaining({
            node: expect.objectContaining({
              path: "root.0.rows.1.cells.1",
            }),
            kind: "table-cell",
          }),
          target: expect.objectContaining({
            node: expect.objectContaining({
              path: "root.0.rows.1.cells.2",
            }),
            kind: "table-cell",
          }),
        }),
      ]),
    );
  });

  test("returns no targetable changes for broad rewrites", () => {
    const previous = Array.from(
      { length: 12 },
      (_, index) => `Old ${index}`,
    ).join("\n\n");
    const next = Array.from({ length: 12 }, (_, index) => `New ${index}`).join(
      "\n\n",
    );

    expect(findDocumentChanges(parse(previous), parse(next))).toEqual([]);
  });

  test("finds sparse root changes across broad spans", () => {
    const previous = createParagraphDocument(12);
    const next = createParagraphDocument(
      12,
      new Map([
        [0, "Changed 1"],
        [11, "Changed 12"],
      ]),
    );
    const changes = findDocumentChanges(parse(previous), parse(next));

    expect(changes).toHaveLength(2);
    expect(changes).toEqual([
      expect.objectContaining({
        changeKind: "modified",
        target: expect.objectContaining({
          node: expect.objectContaining({ path: "root.0" }),
          kind: "block",
        }),
      }),
      expect.objectContaining({
        changeKind: "modified",
        target: expect.objectContaining({
          node: expect.objectContaining({ path: "root.11" }),
          kind: "block",
        }),
      }),
    ]);
  });

  test("finds sparse root additions across broad spans", () => {
    const previous = createParagraphDocument(12);
    const next = `Intro\n\n${previous.trim()}\n\nOutro\n`;
    const changes = findDocumentChanges(parse(previous), parse(next));

    expect(changes).toHaveLength(2);
    expect(changes).toEqual([
      expect.objectContaining({
        changeKind: "added",
        target: expect.objectContaining({
          node: expect.objectContaining({ path: "root.0" }),
          kind: "block",
        }),
      }),
      expect.objectContaining({
        changeKind: "added",
        target: expect.objectContaining({
          node: expect.objectContaining({ path: "root.13" }),
          kind: "block",
        }),
      }),
    ]);
  });

  test("finds heading changes across every section in a broad document", () => {
    const previous = createSectionDocument(10, (index) => `Section ${index + 1}`);
    const next = createSectionDocument(10, (index) => `Updated ${index + 1}`);
    const changes = findDocumentChanges(parse(previous), parse(next));

    expect(changes).toHaveLength(10);
    for (let index = 0; index < 10; index += 1) {
      expect(changes[index]).toMatchObject({
        changeKind: "modified",
        target: {
          kind: "block",
          node: {
            path: `root.${index * 2}`,
          },
        },
      });
    }
  });

  test("finds outline-wide heading changes without stable paragraph anchors", () => {
    const previous = createHeadingDocument(10, (index) => `Section ${index + 1}`);
    const next = createHeadingDocument(10, (index) => `Updated ${index + 1}`);
    const changes = findDocumentChanges(parse(previous), parse(next));

    expect(changes).toHaveLength(10);
    expect(changes.every((change) => change.changeKind === "modified")).toBe(true);
    expect(changes.map((change) => change.target.node.path)).toEqual(
      Array.from({ length: 10 }, (_, index) => `root.${index}`),
    );
  });

  test("returns no targetable changes when diff work exceeds the budget", () => {
    const previous = `Alpha ${"a".repeat(140_000)}\n`;
    const next = `Alpine ${"b".repeat(140_000)}\n`;

    expect(findDocumentChanges(parse(previous), parse(next))).toEqual([]);
  });

  test("retargets a block change after an insertion shifts its path", () => {
    const initial = parse("Alpha\n\nBeta\n");
    const change = blockChangeAt(
      findDocumentChanges(parse("Alpha\n\nOld\n"), initial),
      "root.1",
    );
    const next = parse("Intro\n\nAlpha\n\nBeta\n");

    expect(retargetChange(next, change)).toMatchObject({
      changeKind: "modified",
      previousTarget: {
        ...change.previousTarget,
      },
      target: {
        node: {
          blockId: next.blocks[2]!.id,
          path: "root.2",
        },
        kind: "block",
      },
    });
  });

  test("retargets a table-cell change after a row insertion shifts its path", () => {
    const initial = parse("| A | B |\n| - | - |\n| one | two |\n");
    const change = cellChangeAt(
      findDocumentChanges(
        parse("| A | B |\n| - | - |\n| one | old |\n"),
        initial,
      ),
      "root.0.rows.1.cells.1",
    );
    const next = parse("| A | B |\n| - | - |\n| new | row |\n| one | two |\n");

    expect(retargetChange(next, change)).toMatchObject({
      changeKind: "modified",
      previousTarget: {
        ...change.previousTarget,
      },
      target: {
        node: expect.objectContaining({
          path: "root.0.rows.2.cells.1",
        }),
        kind: "table-cell",
      },
    });
  });

  test("does not retarget a block change when matching content is ambiguous", () => {
    const change = blockChangeAt(
      findDocumentChanges(parse("Old\n"), parse("Alpha\n")),
      "root.0",
    );

    expect(retargetChange(parse("Alpha\n\nAlpha\n"), change)).toBeNull();
  });

  test("does not retarget a table-cell change when matching content is ambiguous", () => {
    const change = cellChangeAt(
      findDocumentChanges(
        parse("| A | B |\n| - | - |\n| one | old |\n"),
        parse("| A | B |\n| - | - |\n| one | two |\n"),
      ),
      "root.0.rows.1.cells.1",
    );

    expect(
      retargetChange(parse("| A | B |\n| - | - |\n| two | two |\n"), change),
    ).toBeNull();
  });
});

function parse(markdown: string) {
  return parseDocument(markdown);
}

function createParagraphDocument(
  count: number,
  replacements: ReadonlyMap<number, string> = new Map(),
) {
  return `${Array.from(
    { length: count },
    (_, index) => replacements.get(index) ?? `Paragraph ${index + 1}`,
  ).join("\n\n")}\n`;
}

function createSectionDocument(count: number, headingForIndex: (index: number) => string) {
  return `${Array.from(
    { length: count },
    (_, index) => `# ${headingForIndex(index)}\n\nBody ${index + 1}`,
  ).join("\n\n")}\n`;
}

function createHeadingDocument(count: number, headingForIndex: (index: number) => string) {
  return `${Array.from({ length: count }, (_, index) => `# ${headingForIndex(index)}`).join(
    "\n\n",
  )}\n`;
}

function retargetChange(
  document: ReturnType<typeof parse>,
  change: DocumentChange,
) {
  return retargetDocumentChanges(document, [change])[0] ?? null;
}

function blockChangeAt(
  changes: readonly DocumentChange[],
  path: string,
): Extract<DocumentChange, { changeKind: "modified" }> {
  const change = changes.find(
    (candidate) =>
      candidate.target.kind === "block" && candidate.target.node.path === path,
  );

  if (
    !change ||
    change.changeKind !== "modified" ||
    change.target.kind !== "block"
  ) {
    throw new Error(`Expected block change at ${path}`);
  }

  return change;
}

function cellChangeAt(
  changes: readonly DocumentChange[],
  path: string,
): Extract<DocumentChange, { changeKind: "modified" }> {
  const change = changes.find(
    (candidate) =>
      candidate.target.kind === "table-cell" &&
      candidate.target.node.path === path,
  );

  if (
    !change ||
    change.changeKind !== "modified" ||
    change.target.kind !== "table-cell"
  ) {
    throw new Error(`Expected table-cell change at ${path}`);
  }

  return change;
}
