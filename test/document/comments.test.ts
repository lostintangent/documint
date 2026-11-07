import { describe, expect, test } from "bun:test";
import { listAnchorContainers, repairCommentThread, resolveCommentThread } from "@/document";
import { parseDocument } from "@/markdown";
import { createAnchoredThread } from "./helpers";

describe("Comment anchors", () => {
  // Each row comments on text in the first file, then resolves the saved
  // thread in the second. A resolved comment reads "<container>:<start> <quote>",
  // marked "(repaired)" when resolving it rewrites the saved anchor.
  test.each<[string, string, number, [number, number], string, string | null]>([
    [
      "the text around it changes",
      "Review surface anchors survive markdown reloads.\n",
      0,
      [15, 30],
      "Review surface editing keeps anchors survive markdown reloads.\n",
      "0:29 anchors survive (repaired)",
    ],
    [
      "its text is edited in place",
      "Typpoed person name appears here.\n",
      0,
      [0, 12],
      "Typoed person name appears here.\n",
      "0:0 Typoed pers (repaired)",
    ],
    ["it overlaps a copy of its quote", "Yeseses\n", 0, [3, 7], "Yeseses\n", "0:3 eses"],
    [
      "its paragraph moves down",
      "old occupant\n\ntarget phrase\n",
      1,
      [0, 6],
      "inserted paragraph\n\nold occupant\n\ntarget phrase\n",
      "2:0 target",
    ],
    [
      "its table cell moves down",
      "| A | B |\n| - | - |\n| old | target |\n",
      3,
      [0, 6],
      "| A | B |\n| - | - |\n| inserted | filler |\n| old | target |\n",
      "5:0 target",
    ],
    [
      "its paragraph becomes a heading",
      "Promote this line.\n",
      0,
      [0, 12],
      "# Promote this line.\n",
      "0:0 Promote this",
    ],
    [
      "a paragraph repeats its table cell's text",
      "Yes\n\n| A |\n| --- |\n| Yes |\n",
      2,
      [0, 3],
      "Yes\n\n| A |\n| --- |\n| Yes |\n",
      "2:0 Yes",
    ],
    [
      "its text is edited among lines shaped like it",
      "Owner: Alice (due Friday)\n\nOwner: Bobby (due Friday)\n",
      0,
      [7, 12],
      "Owner: Alicia (due Friday)\n\nOwner: Bobby (due Friday)\n",
      "0:7 Alicia (repaired)",
    ],
    [
      "its text is replaced among lines shaped like it",
      "Owner: Alice (due Friday)\n\nOwner: Bartholomew (due Friday)\n",
      0,
      [7, 12],
      "Owner: Carol (due Friday)\n\nOwner: Bartholomew (due Friday)\n",
      "0:7 Carol (repaired)",
    ],
    [
      "its quote is replaced, leaving context on one side",
      "old occupant\n\ntarget phrase\n",
      1,
      [0, 6],
      "old occupant\n\nreplacement phrase\n",
      null,
    ],
  ])(
    "resolves a saved comment when %s",
    (_, source, containerIndex, [start, end], edited, shown) => {
      const { thread } = createAnchoredThread(parseDocument(source), start, end, "note", {
        containerIndex,
      });
      const containers = listAnchorContainers(parseDocument(edited));
      const resolution = resolveCommentThread(thread, containers);
      const index = containers.findIndex(({ path }) => path === resolution?.match.containerPath);
      const repaired = resolution && repairCommentThread(thread, resolution) !== thread;

      expect(
        resolution &&
          `${index}:${resolution.match.startOffset} ${resolution.quote}${repaired ? " (repaired)" : ""}`,
      ).toBe(shown);
    },
  );

  test("lists nested anchor containers in visible order", () => {
    const snapshot = parseDocument(`# Title

> Quote body

:::callout{tone="info"}
Directive body
:::

- outer item
  - inner item

\`\`\`ts
console.log("hi");
\`\`\`

| A | B |
| - | - |
| one | two |
`);
    const containers = listAnchorContainers(snapshot);

    expect(containers.map((container) => `${container.containerKind}:${container.text}`)).toEqual([
      "text:Title",
      "text:Quote body",
      "text:outer item",
      "text:inner item",
      'code:console.log("hi");',
      "tableCell:A",
      "tableCell:B",
      "tableCell:one",
      "tableCell:two",
    ]);
    expect(new Set(containers.slice(5).map((container) => container.path)).size).toBe(4);
  });
});
