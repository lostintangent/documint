import { describe, expect, test } from "bun:test";
import {
  blockPathContainsPath,
  blockPathSiblingIndex,
  parentBlockPath,
  resolveBlockByPath,
  resolveTableCellByPath,
  resolveTableCellPathMatch,
  rootIndexForPath,
  tableCellPositionFromPath,
} from "@/document";
import { parseDocument } from "@/markdown";

describe("document paths", () => {
  test("resolves root and nested block paths", () => {
    const document = parseDocument(`> parent
>
> child

outside
`);
    const root = document.blocks[0];

    if (root?.type !== "blockquote") {
      throw new Error("Expected blockquote root");
    }

    expect(resolveBlockByPath(document, "root.0")).toBe(root);
    expect(resolveBlockByPath(document, "root.0.children.0")).toBe(root.children[0]);
    expect(resolveBlockByPath(document, "root.1")).toBe(document.blocks[1]);
  });

  test("rejects malformed block paths", () => {
    const document = parseDocument("alpha\n");

    expect(resolveBlockByPath(document, "root")).toBeNull();
    expect(resolveBlockByPath(document, "root.-1")).toBeNull();
    expect(resolveBlockByPath(document, "root.0.children")).toBeNull();
    expect(resolveBlockByPath(document, "root.0.children.nope")).toBeNull();
    expect(resolveBlockByPath(document, "root.0.rows.0.cells.0")).toBeNull();
  });

  test("derives block parents and sibling indexes from paths", () => {
    expect(parentBlockPath("root.2")).toBeNull();
    expect(parentBlockPath("root.2.children.3")).toBe("root.2");
    expect(parentBlockPath("root.2.children.3.children.1")).toBe(
      "root.2.children.3",
    );
    expect(parentBlockPath("root.2.children.1.rows.3.cells.4")).toBe(
      "root.2.children.1",
    );

    expect(blockPathSiblingIndex("root.2")).toBe(2);
    expect(blockPathSiblingIndex("root.2.children.3")).toBe(3);
    expect(blockPathSiblingIndex("root.2.children.3.children.1")).toBe(1);
    expect(blockPathSiblingIndex("root.0.rows.0.cells.0")).toBeNull();
  });

  test("derives root indexes from document paths", () => {
    expect(rootIndexForPath("root.2")).toBe(2);
    expect(rootIndexForPath("root.2.children")).toBe(2);
    expect(rootIndexForPath("root.2.children.1.rows.3.cells.4")).toBe(2);

    expect(rootIndexForPath("root")).toBeNull();
    expect(rootIndexForPath("root.-1")).toBeNull();
    expect(rootIndexForPath("root.nope.children")).toBeNull();
    expect(rootIndexForPath("other.2")).toBeNull();
  });

  test("resolves table-cell paths with row and cell context", () => {
    const document = parseDocument(`| A | B | C |
| - | - | - |
| one | two | three |
| four | five | six |
`);
    const cell = resolveTableCellByPath(document, "root.0.rows.1.cells.1");
    const match = resolveTableCellPathMatch(document, "root.0.rows.1.cells.1");

    expect(cell?.plainText).toBe("two");
    expect(match).toMatchObject({
      cell,
      cellIndex: 1,
      nextCell: { plainText: "three" },
      nextRow: {
        cells: [{ plainText: "four" }, { plainText: "five" }, { plainText: "six" }],
      },
      previousCell: { plainText: "one" },
      rowIndex: 1,
    });
  });

  test("rejects malformed table-cell paths", () => {
    const document = parseDocument(`| A | B |
| - | - |
| one | two |
`);

    expect(resolveTableCellByPath(document, "root.0.rows.-1.cells.0")).toBeNull();
    expect(resolveTableCellByPath(document, "root.0.rows.1.cells.-1")).toBeNull();
    expect(resolveTableCellByPath(document, "root.0.rows.3.cells.0")).toBeNull();
    expect(resolveTableCellByPath(document, "root.0.rows.1.cells.3")).toBeNull();
    expect(resolveTableCellByPath(document, "root.0.children.0.rows.1.cells.0")).toBeNull();
    expect(resolveTableCellByPath(document, "root.0.rows.1")).toBeNull();
  });

  test("derives table-cell positions from paths", () => {
    expect(tableCellPositionFromPath("root.2.children.1.rows.3.cells.4")).toEqual({
      cellIndex: 4,
      rowIndex: 3,
    });
    expect(tableCellPositionFromPath("root.2.children.1.rows.3.cells.nope")).toBeNull();
  });

  test("checks strict block-path containment", () => {
    expect(blockPathContainsPath("root.2", "root.2")).toBeTrue();
    expect(blockPathContainsPath("root.2", "root.2.children.3")).toBeTrue();
    expect(
      blockPathContainsPath(
        "root.2.children.3",
        "root.2.children.3.children.1",
      ),
    ).toBeTrue();
    expect(blockPathContainsPath("root.2", "root.2.children.1.children")).toBeTrue();
    expect(blockPathContainsPath("root.2", "root.2.children.1.source")).toBeTrue();
    expect(blockPathContainsPath("root.2", "root.2.children.1.rows.3")).toBeTrue();
    expect(blockPathContainsPath("root.2", "root.2.children.1.rows.3.cells.4")).toBeTrue();
    expect(
      blockPathContainsPath(
        "root.2.children.1",
        "root.2.children.1.rows.3.cells.4",
      ),
    ).toBeTrue();

    expect(blockPathContainsPath("root.1", "root.2")).toBeFalse();
    expect(blockPathContainsPath("root.1", "root.10")).toBeFalse();
    expect(blockPathContainsPath("root.2.children.3", "root.2")).toBeFalse();
    expect(blockPathContainsPath("root.2.children.4", "root.2.children.3")).toBeFalse();
    expect(blockPathContainsPath("root.1", "root.2.rows.3.cells.4")).toBeFalse();
    expect(
      blockPathContainsPath(
        "root.2.children.4",
        "root.2.children.1.rows.3.cells.4",
      ),
    ).toBeFalse();
  });

  test("rejects unsupported path shapes for containment", () => {
    expect(blockPathContainsPath("root.0.source", "root.0")).toBeFalse();
    expect(blockPathContainsPath("root.0.children", "root.0.children.1")).toBeFalse();
    expect(blockPathContainsPath("root", "root.0")).toBeFalse();
    expect(blockPathContainsPath("root.0", "root.0.children.nope")).toBeFalse();
    expect(blockPathContainsPath("root.0", "root.0.rows.nope.cells.0")).toBeFalse();
  });
});
