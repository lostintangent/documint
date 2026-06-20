import { describe, expect, test } from "bun:test";
import {
  findBlockWithPathById,
  resolveBlockByPath,
  resolveTableCellByPath,
  resolveTableCellPathMatch,
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
        cells: [
          { plainText: "four" },
          { plainText: "five" },
          { plainText: "six" },
        ],
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

  test("finds blocks with their current canonical path", () => {
    const document = parseDocument(`> parent
>
> child
`);
    const root = document.blocks[0];

    if (root?.type !== "blockquote") {
      throw new Error("Expected blockquote root");
    }

    expect(findBlockWithPathById(document, root.id)).toEqual({
      block: root,
      path: "root.0",
    });
    expect(findBlockWithPathById(document, root.children[0]!.id)).toEqual({
      block: root.children[0],
      path: "root.0.children.0",
    });
    expect(findBlockWithPathById(document, "missing")).toBeNull();
  });
});
