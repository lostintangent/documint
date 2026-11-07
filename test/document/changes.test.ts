import { describe, expect, test } from "bun:test";
import {
  compareDocuments,
  createDocument,
  createTableBlock,
  createTableCell,
  createTableRow,
  createText,
  findDocumentChanges,
} from "@/document";
import { parseDocument } from "@/markdown";

describe("document changes", () => {
  test("finds checkbox changes at list-item granularity", () => {
    const changes = findDocumentChanges(parse("- [ ] task\n"), parse("- [x] task\n"));

    expect(changes.map(changeSummary)).toEqual([["modified", "root.0.children.0"]]);
  });

  test("finds inserted table rows as added without marking shifted rows", () => {
    const changes = findDocumentChanges(
      parse("| A | B |\n| - | - |\n| one | two |\n| three | four |\n"),
      parse("| A | B |\n| - | - |\n| one | two |\n| new | row |\n| three | four |\n"),
    );

    expect(changes.map(changeSummary)).toEqual([
      ["added", "root.0.rows.2.cells.0"],
      ["added", "root.0.rows.2.cells.1"],
    ]);
  });

  test("finds added table cells and shifted modified cells in the same row window", () => {
    const changes = findDocumentChanges(
      parse("| A | B |\n| - | - |\n| one | old |\n| two | stable |\n"),
      parse("| A | B |\n| - | - |\n| new | row |\n| one | changed |\n| two | stable |\n"),
    );

    expect(changes).toEqual([
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
      expect.objectContaining({
        kind: "modified",
        previousAnchor: expect.objectContaining({
          kind: "table-cell",
          path: "root.0.rows.1.cells.1",
        }),
        anchor: expect.objectContaining({
          kind: "table-cell",
          path: "root.0.rows.2.cells.1",
        }),
      }),
    ]);
  });

  test("finds added table columns and shifted modified cells in the same row", () => {
    const changes = findDocumentChanges(
      parse("| A | B | C |\n| - | - | - |\n| one | old | stable |\n"),
      parse("| A | X | B | C |\n| - | - | - | - |\n| one | added | old changed | stable |\n"),
    );

    expect(changes).toEqual([
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
      expect.objectContaining({
        kind: "modified",
        previousAnchor: expect.objectContaining({
          kind: "table-cell",
          path: "root.0.rows.1.cells.1",
        }),
        anchor: expect.objectContaining({
          kind: "table-cell",
          path: "root.0.rows.1.cells.2",
        }),
      }),
    ]);
  });

  test("compares broad rewrites exhaustively", () => {
    const previous = Array.from({ length: 12 }, (_, index) => `Old ${index}`).join("\n\n");
    const next = Array.from({ length: 12 }, (_, index) => `New ${index}`).join("\n\n");

    expect(findDocumentChanges(parse(previous), parse(next))).toEqual([]);
    expect(compareDocuments(parse(previous), parse(next)).changes).toHaveLength(12);
    expect(compareDocuments(parse(""), parse(next)).changes).toHaveLength(12);
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
        kind: "modified",
        anchor: expect.objectContaining({
          kind: "block",
          path: "root.0",
        }),
      }),
      expect.objectContaining({
        kind: "modified",
        anchor: expect.objectContaining({
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
        kind: "added",
        anchor: expect.objectContaining({
          kind: "block",
          path: "root.0",
        }),
      }),
      expect.objectContaining({
        kind: "added",
        anchor: expect.objectContaining({
          kind: "block",
          path: "root.13",
        }),
      }),
    ]);
  });

  test("keeps deleted roots in document order only in complete comparisons", () => {
    const previous = parse(
      "Removed leading\n\nBefore\n\nRemoved one\n\nRemoved two\n\nRetained\n\nRemoved trailing\n",
    );
    const next = parse("Before\n\nRetained\n");
    const comparison = compareDocuments(previous, next);

    expect(findDocumentChanges(previous, next)).toEqual([]);
    expect(comparison.document.blocks.map((block) => block.plainText)).toEqual([
      "Removed leading",
      "Before",
      "Removed one",
      "Removed two",
      "Retained",
      "Removed trailing",
    ]);
    expect(comparison.changes.map(changeSummary)).toEqual([
      ["deleted", "root.0"],
      ["deleted", "root.2"],
      ["deleted", "root.3"],
      ["deleted", "root.5"],
    ]);
  });

  test("keeps deleted list items in their original container", () => {
    const comparison = compareDocuments(
      parse("- Before\n- Removed\n- After\n"),
      parse("- Before\n- After\n"),
    );
    const list = comparison.document.blocks[0];

    expect(list?.type).toBe("list");
    expect(list?.type === "list" ? list.items.map((item) => item.plainText) : []).toEqual([
      "Before",
      "Removed",
      "After",
    ]);
    expect(comparison.changes).toEqual([
      expect.objectContaining({
        anchor: expect.objectContaining({ path: "root.0.children.1" }),
        kind: "deleted",
      }),
    ]);
  });

  test("keeps deleted table rows while aligning later additions and modifications", () => {
    const previous = parse(`| Area | Status |
| - | - |
| Removed | Previous only |
| Stable A | Same |
| Stable B | Same |
| Stable C | Same |
| Stable D | Same |
| Changed | Before |
| Stable E | Same |
`);
    const next = parse(`| Area | Status |
| - | - |
| Stable A | Same |
| Stable B | Same |
| Added | Current only |
| Stable C | Same |
| Stable D | Same |
| Changed | After |
| Stable E | Same |
`);
    const comparison = compareDocuments(previous, next);
    const table = comparison.document.blocks[0];

    expect(table?.type === "table" ? table.rows.map((row) => row.cells[0]?.plainText) : []).toEqual(
      [
        "Area",
        "Removed",
        "Stable A",
        "Stable B",
        "Added",
        "Stable C",
        "Stable D",
        "Changed",
        "Stable E",
      ],
    );
    expect(comparison.changes.map(changeSummary)).toEqual([
      ["added", "root.0.rows.4.cells.0"],
      ["added", "root.0.rows.4.cells.1"],
      ["modified", "root.0.rows.7.cells.1"],
      ["deleted", "root.0.rows.1.cells.0"],
      ["deleted", "root.0.rows.1.cells.1"],
    ]);
  });

  test("keeps an all-content deletion without the broad-window bailout", () => {
    const previous = parse(
      Array.from({ length: 12 }, (_, index) => `Removed ${index + 1}`).join("\n\n"),
    );
    const comparison = compareDocuments(previous, parse(""));

    expect(comparison.document.blocks.map((block) => block.plainText)).toEqual(
      previous.blocks.map((block) => block.plainText),
    );
    expect(comparison.changes).toHaveLength(12);
    expect(comparison.changes.every((change) => change.kind === "deleted")).toBe(true);
  });

  test("finds heading changes across every section in a broad document", () => {
    const previous = createSectionDocument(10, (index) => `Section ${index + 1}`);
    const next = createSectionDocument(10, (index) => `Updated ${index + 1}`);
    const changes = findDocumentChanges(parse(previous), parse(next));

    expect(changes).toHaveLength(10);
    for (let index = 0; index < 10; index += 1) {
      expect(changes[index]).toMatchObject({
        kind: "modified",
        anchor: {
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
    expect(changes.every((change) => change.kind === "modified")).toBe(true);
    expect(changes.map((change) => change.anchor.path)).toEqual(
      Array.from({ length: 10 }, (_, index) => `root.${index}`),
    );
  });

  test("retains a terminal 64 changes but aborts when another target remains", () => {
    const { next, previous } = createTableAlignmentDocuments(65);

    expect(findTableAlignmentChanges(64)).toHaveLength(64);
    expect(findTableAlignmentChanges(65)).toEqual([]);
    expect(compareDocuments(previous, next).changes).toHaveLength(65);
  });

  test("returns changes below the work budget and none at the exact limit", () => {
    const belowBudget = findDocumentChanges(
      parse(`${"a".repeat(16_896)}\n`),
      parse(`${"b".repeat(16_897)}\n`),
    );
    const atBudget = findDocumentChanges(
      parse(`Stable\n\n${"a".repeat(16_641)}\n`),
      parse(`Stable\n\n${"b".repeat(16_897)}\n`),
    );

    expect(belowBudget).toHaveLength(1);
    expect(atBudget).toEqual([]);
  });
});

function parse(markdown: string) {
  return parseDocument(markdown);
}

function changeSummary(change: {
  readonly anchor: { readonly path: string };
  readonly kind: string;
}) {
  return [change.kind, change.anchor.path];
}

function createTableAlignmentDocuments(cellCount: number) {
  const row = createTableRow(
    Array.from({ length: cellCount }, (_, index) =>
      createTableCell([createText(`Cell ${index + 1}`)]),
    ),
  );
  const previous = createDocument([
    createTableBlock({
      align: Array.from({ length: cellCount }, () => null),
      rows: [row],
    }),
  ]);
  const next = createDocument([
    createTableBlock({
      align: Array.from({ length: cellCount }, (_, index) => (index === 0 ? "left" : null)),
      rows: [row],
    }),
  ]);

  return { next, previous };
}

function findTableAlignmentChanges(cellCount: number) {
  const { next, previous } = createTableAlignmentDocuments(cellCount);
  return findDocumentChanges(previous, next);
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
