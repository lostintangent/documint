import { describe, expect, test } from "bun:test";
import {
  resolveBlockContentHash,
  resolveTableCellContentHash,
} from "@/document/query/content-hash";
import { parseDocument } from "@/markdown";

describe("document content-hash", () => {
  test("ignore root position while preserving semantic content", () => {
    const first = parseDocument("Alpha\n\nBeta\n");
    const second = parseDocument("Intro\n\nAlpha\n");

    expect(resolveBlockContentHash(first.blocks[0]!)).toBe(
      resolveBlockContentHash(second.blocks[1]!),
    );
  });

  test("include inline marks and link destinations", () => {
    const plain = parseDocument("Alpha [site](https://a.example)\n");
    const marked = parseDocument("**Alpha** [site](https://a.example)\n");
    const relinked = parseDocument("Alpha [site](https://b.example)\n");

    expect(resolveBlockContentHash(plain.blocks[0]!)).not.toBe(
      resolveBlockContentHash(marked.blocks[0]!),
    );
    expect(resolveBlockContentHash(plain.blocks[0]!)).not.toBe(
      resolveBlockContentHash(relinked.blocks[0]!),
    );
  });

  test("include code metadata and table cell content", () => {
    const code = parseDocument("```ts meta\nconsole.log(1)\n```\n");
    const changedMeta = parseDocument("```ts other\nconsole.log(1)\n```\n");
    const table = parseDocument("| A | B |\n| - | - |\n| one | two |\n");
    const changedTable = parseDocument("| A | B |\n| - | - |\n| one | three |\n");

    expect(resolveBlockContentHash(code.blocks[0]!)).not.toBe(
      resolveBlockContentHash(changedMeta.blocks[0]!),
    );
    const firstCell =
      table.blocks[0]!.type === "table" ? table.blocks[0]!.rows[1]!.cells[1]! : null;
    const changedCell =
      changedTable.blocks[0]!.type === "table" ? changedTable.blocks[0]!.rows[1]!.cells[1]! : null;
    expect(firstCell && changedCell).toBeTruthy();
    expect(resolveTableCellContentHash(firstCell!)).not.toBe(
      resolveTableCellContentHash(changedCell!),
    );
  });
});
