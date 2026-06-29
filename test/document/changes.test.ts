import { describe, expect, test } from "bun:test";
import { findDocumentChanges } from "@/document";
import { parseDocument } from "@/markdown";

describe("document changes", () => {
  test("finds targeted block changes", () => {
    const next = parse("Alpine\n");
    const changes = findDocumentChanges(parse("Alpha\n"), next);

    expect(changes).toEqual([
      expect.objectContaining({
        changeKind: "modified",
        previousTarget: expect.objectContaining({
          kind: "block",
          path: "root.0",
        }),
        target: expect.objectContaining({
          kind: "block",
          path: "root.0",
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
          kind: "table-cell",
          path: "root.0.rows.1.cells.1",
        }),
        target: expect.objectContaining({
          kind: "table-cell",
          path: "root.0.rows.1.cells.1",
        }),
      }),
    ]);
  });

  test("finds added table cells and shifted modified cells in the same row window", () => {
    const changes = findDocumentChanges(
      parse("| A | B |\n| - | - |\n| one | old |\n| two | stable |\n"),
      parse("| A | B |\n| - | - |\n| new | row |\n| one | changed |\n| two | stable |\n"),
    );

    expect(changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          changeKind: "added",
          target: expect.objectContaining({
            kind: "table-cell",
            path: "root.0.rows.1.cells.0",
          }),
        }),
        expect.objectContaining({
          changeKind: "added",
          target: expect.objectContaining({
            kind: "table-cell",
            path: "root.0.rows.1.cells.1",
          }),
        }),
        expect.objectContaining({
          changeKind: "modified",
          previousTarget: expect.objectContaining({
            kind: "table-cell",
            path: "root.0.rows.1.cells.1",
          }),
          target: expect.objectContaining({
            kind: "table-cell",
            path: "root.0.rows.2.cells.1",
          }),
        }),
      ]),
    );
  });

  test("finds added table columns and shifted modified cells in the same row", () => {
    const changes = findDocumentChanges(
      parse("| A | B | C |\n| - | - | - |\n| one | old | stable |\n"),
      parse("| A | X | B | C |\n| - | - | - | - |\n| one | added | old changed | stable |\n"),
    );

    expect(changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          changeKind: "added",
          target: expect.objectContaining({
            kind: "table-cell",
            path: "root.0.rows.1.cells.1",
          }),
        }),
        expect.objectContaining({
          changeKind: "modified",
          previousTarget: expect.objectContaining({
            kind: "table-cell",
            path: "root.0.rows.1.cells.1",
          }),
          target: expect.objectContaining({
            kind: "table-cell",
            path: "root.0.rows.1.cells.2",
          }),
        }),
      ]),
    );
  });

  test("returns no targetable changes for broad rewrites", () => {
    const previous = Array.from({ length: 12 }, (_, index) => `Old ${index}`).join("\n\n");
    const next = Array.from({ length: 12 }, (_, index) => `New ${index}`).join("\n\n");

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
          kind: "block",
          path: "root.0",
        }),
      }),
      expect.objectContaining({
        changeKind: "modified",
        target: expect.objectContaining({
          kind: "block",
          path: "root.11",
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
          kind: "block",
          path: "root.0",
        }),
      }),
      expect.objectContaining({
        changeKind: "added",
        target: expect.objectContaining({
          kind: "block",
          path: "root.13",
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
          path: `root.${index * 2}`,
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
    expect(changes.map((change) => change.target.path)).toEqual(
      Array.from({ length: 10 }, (_, index) => `root.${index}`),
    );
  });

  test("returns no targetable changes when diff work exceeds the budget", () => {
    const previous = `Alpha ${"a".repeat(140_000)}\n`;
    const next = `Alpine ${"b".repeat(140_000)}\n`;

    expect(findDocumentChanges(parse(previous), parse(next))).toEqual([]);
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
