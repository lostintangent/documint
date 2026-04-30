// Clipboard command coverage: copy → markdown serialization, markdown →
// paste with structural seam-merge, and the round trips between them.
//
// Tests are grouped by `describe` blocks, ordered most-common to least:
//   1. By block kind: paragraphs → headings → lists → blockquotes → tables
//      → code → thematic breaks. Within each, copy comes before paste, and
//      common cases come before edge cases.
//   2. Cross-cutting concerns: cross-block selections, round-trips,
//      undo/redo, comment-thread repair.
//
// Tests assert by scenario, not by individual property: when a paste
// affects both the document and the caret, both go in one test next to
// each other rather than splitting into two. Helpers at the bottom
// (`copyWholeRegion`, `copySubstring`, `copyAcross`, `pasteInto`,
// `pasteIntoState`) capture the four common shapes so each test body
// reads like a one-line spec.

import { describe, expect, test } from "bun:test";
import {
  addComment,
  copySelection,
  deleteSelection,
  pasteFragment,
  redo,
  setSelection,
  undo,
  type EditorRegion,
  type EditorState,
} from "@/editor/state";
import { getCommentState } from "@/editor";
import { parseFragment, serializeFragment } from "@/markdown";
import { getRegion, placeAt, selectIn, selectSubstring, setup, toMarkdown } from "../helpers";

describe("Paragraphs", () => {
  test("copy: collapsed selection returns null", () => {
    const state = setup("alpha\n");
    const placed = placeAt(state, getRegion(state, "alpha"), 0);

    expect(copySelection(placed)).toBeNull();
  });

  test("copy: substring emits bare text", () => {
    expect(copySubstring("Hello world\n", "Hello world", "Hello")).toBe("Hello");
  });

  test("copy: bold mark survives a whole-region selection", () => {
    expect(copyWholeRegion("**bold** plain\n", "bold plain")).toBe("**bold** plain");
  });

  test("copy: italic mark survives a substring selection", () => {
    // Block-level structure drops on partial selection but inline marks are
    // part of the slice itself — italic survives.
    expect(copySubstring("*italic content* trail\n", "italic content trail", "content"))
      .toBe("*content*");
  });

  test("paste: plain text inserts inline at the caret", () => {
    expect(pasteInto("Hello\n", { region: "Hello", offset: "end" }, " world"))
      .toBe("Hello world\n");
  });

  test("paste: italic markdown round-trips through the structural path", () => {
    expect(pasteInto("Hello \n", { region: "Hello ", offset: "end" }, "*world*"))
      .toBe("Hello *world*\n");
  });

  test("paste: italic markdown mid-text absorbs at the front seam and lands the caret after it", () => {
    const next = pasteIntoState("Hello world\n", { region: "Hello world", offset: 6 }, "*X*");

    expect(toMarkdown(next)).toBe("Hello *X*world\n");
    expect(caret(next)).toEqual({ regionText: "Hello Xworld", offset: 7 });
  });

  test("paste: empty source is a no-op", () => {
    const state = setup("Hello\n");
    const placed = placeAt(state, getRegion(state, "Hello"), 0);

    expect(pasteFragment(placed, parseFragment(""))).toBeNull();
  });

  test("paste: two paragraphs into mid-text splits and absorbs at both seams", () => {
    expect(pasteInto("Hello world\n", { region: "Hello world", offset: 6 }, "first\n\nsecond"))
      .toBe("Hello first\n\nsecondworld\n");
  });

  test("paste: paragraph + heading + paragraph absorbs around the heading", () => {
    // Front paragraph absorbs into prefix; trailing paragraph absorbs into
    // suffix; the heading remains structural between them.
    expect(pasteInto("Hello world\n", { region: "Hello world", offset: 6 }, "X\n\n# H\n\nY"))
      .toBe("Hello X\n\n# H\n\nYworld\n");
  });
});

describe("Headings", () => {
  test("copy: whole-region selection carries the marker", () => {
    expect(copyWholeRegion("# Heading text\n", "Heading text")).toBe("# Heading text");
  });

  test("copy: partial selection drops the marker", () => {
    expect(copySubstring("## Heading\n", "Heading", "Head")).toBe("Head");
  });

  test("paste: into an empty paragraph replaces it", () => {
    expect(pasteInto("\n", { region: "", offset: "start" }, "## Hello\n")).toBe("## Hello\n");
  });

  test("paste: mid-paragraph splits the paragraph cleanly", () => {
    // Trailing whitespace on the prefix paragraph is normalized away by the
    // markdown serializer; the structural break around the heading survives.
    expect(pasteInto("alpha beta\n", { region: "alpha beta", offset: 6 }, "# H\n"))
      .toBe("alpha\n\n# H\n\nbeta\n");
  });
});

describe("Lists", () => {
  test("copy: whole item produces a one-item list with bullet", () => {
    expect(copyWholeRegion("- one\n- two\n- three\n", "two")).toBe("- two");
  });

  test("copy: partial inside an item drops the bullet", () => {
    expect(copySubstring("- alpha beta\n", "alpha beta", "beta")).toBe("beta");
  });

  test("copy: cross-item whole-coverage selection produces all bullets", () => {
    expect(
      copyAcross(
        "- one\n- two\n- three\n",
        { region: "one", offset: "start" },
        { region: "three", offset: "end" },
      ),
    ).toBe("- one\n- two\n- three");
  });

  test("copy: cross-item partial selection trims endpoints, keeps middle", () => {
    expect(
      copyAcross(
        "- alpha\n- beta\n- gamma\n",
        { region: "alpha", offset: 2 },
        { region: "gamma", offset: 2 },
      ),
    ).toBe("- pha\n- beta\n- ga");
  });

  test("copy: ordered list preserves its marker", () => {
    // The serializer uses the canonical "lazy 1." style for ordered lists
    // whose `start` was inferred — every item gets "1.", and renderers
    // number them sequentially.
    expect(
      copyAcross(
        "1. one\n2. two\n",
        { region: "one", offset: "start" },
        { region: "two", offset: "end" },
      ),
    ).toBe("1. one\n1. two");
  });

  test("copy: task list preserves checkbox state", () => {
    expect(copyWholeRegion("- [x] done\n- [ ] todo\n", "done")).toBe("- [x] done");
  });

  test("copy: nested list preserves all levels of nesting", () => {
    expect(
      copyAcross(
        "- outer\n  - middle\n    - inner\n",
        { region: "outer", offset: "start" },
        { region: "inner", offset: "end" },
      ),
    ).toBe("- outer\n  - middle\n    - inner");
  });

  test("paste: deeply nested list into an empty paragraph preserves nesting", () => {
    expect(
      pasteInto("\n", { region: "", offset: "start" }, "- outer\n  - middle\n    - inner\n"),
    ).toBe("- outer\n  - middle\n    - inner\n");
  });

  test("paste: text into an empty item keeps the bullet", () => {
    expect(pasteInto("- \n", { region: "", offset: "start" }, "hello")).toBe("- hello\n");
  });

  test("paste: text into the middle of an item paragraph stays inline", () => {
    expect(pasteInto("- alpha beta\n", { region: "alpha beta", offset: 6 }, "X"))
      .toBe("- alpha Xbeta\n");
  });

  test("paste: into an empty paragraph replaces it and lands the caret at end of the last item", () => {
    const next = pasteIntoState("\n", { region: "", offset: "start" }, "- one\n- two\n- three\n");

    expect(toMarkdown(next)).toBe("- one\n- two\n- three\n");
    expect(caret(next)).toEqual({ regionText: "three", offset: 5 });
  });

  test("paste: list mid-paragraph splits the paragraph cleanly", () => {
    expect(pasteInto("alpha beta\n", { region: "alpha beta", offset: 6 }, "- item\n"))
      .toBe("alpha\n\n- item\n\nbeta\n");
  });

  test("paste: single-item list into an empty item does not nest or duplicate", () => {
    expect(pasteInto("- \n", { region: "", offset: "start" }, "- hello\n")).toBe("- hello\n");
  });

  test("paste: multi-item list into an empty middle item flattens via container peel", () => {
    expect(pasteInto("- a\n- \n- b\n", { region: "", offset: "start" }, "- Y\n- Z\n"))
      .toBe("- a\n- Y\n- Z\n- b\n");
  });

  test("paste: list at end of an existing list extends it via container peel", () => {
    const next = pasteIntoState("- a\n- b\n", { region: "b", offset: "end" }, "\n- c\n- d\n");

    expect(toMarkdown(next)).toBe("- a\n- b\n- c\n- d\n");
    expect(caret(next)).toEqual({ regionText: "d", offset: 1 });
  });

  test("paste: heading into an item splits the surrounding list", () => {
    // Heading breaks out of the list; the remaining list item flows after.
    expect(pasteInto("- alpha\n- beta\n", { region: "alpha", offset: "end" }, "\n# H\n"))
      .toBe("- alpha\n\n# H\n\n- beta\n");
  });

  test("paste: italic markdown inside an item stays inline within the item", () => {
    // Inline-kind fragments splice into the destination's leaf without
    // disturbing the surrounding container — the list stays a single item
    // and the marked content lands inline in it.
    expect(pasteInto("- alpha beta\n", { region: "alpha beta", offset: 6 }, "*X*"))
      .toBe("- alpha *X*beta\n");
  });

  test("paste: marked inlines into an item preserve all marks", () => {
    expect(
      pasteInto("- alpha beta\n", { region: "alpha beta", offset: 6 }, "**bold** and *italic*"),
    ).toBe("- alpha **bold** and *italic*beta\n");
  });
});

describe("Blockquotes", () => {
  test("copy: whole-region selection carries the marker", () => {
    expect(copyWholeRegion("> quoted line\n", "quoted line")).toBe("> quoted line");
  });

  test("copy: partial selection drops the marker", () => {
    expect(copySubstring("> alpha beta\n", "alpha beta", "beta")).toBe("beta");
  });

  test("copy: cross-paragraph selection keeps the quote shape", () => {
    expect(
      copyAcross(
        "> first\n>\n> second\n",
        { region: "first", offset: "start" },
        { region: "second", offset: "end" },
      ),
    ).toBe("> first\n>\n> second");
  });

  test("paste: into an empty paragraph replaces it", () => {
    expect(pasteInto("\n", { region: "", offset: "start" }, "> quoted\n"))
      .toBe("> quoted\n");
  });

  test("paste: text into a blockquote stays inline within the quote", () => {
    expect(pasteInto("> quoted\n", { region: "quoted", offset: "end" }, " more"))
      .toBe("> quoted more\n");
  });

  test("paste: marked inlines into a blockquote stay inline within the quote", () => {
    expect(pasteInto("> quoted\n", { region: "quoted", offset: "end" }, " *more*"))
      .toBe("> quoted *more*\n");
  });

  test("paste: into an existing blockquote merges children via container peel", () => {
    const next = pasteIntoState(
      "> existing\n",
      { region: "existing", offset: "end" },
      "\n> appended\n",
    );

    expect(toMarkdown(next)).toBe("> existing\n>\n> appended\n");
    expect(caret(next)).toEqual({ regionText: "appended", offset: 8 });
  });
});

describe("Tables", () => {
  test("copy: whole cell content emits bare text — a single cell isn't markdown-shaped", () => {
    expect(copyWholeRegion("| A | B |\n| --- | --- |\n| one | two |\n", "one")).toBe("one");
  });

  test("copy: partial cell content emits the slice", () => {
    expect(copySubstring("| A | B |\n| --- | --- |\n| one fish | two |\n", "one fish", "fish"))
      .toBe("fish");
  });

  test("copy: cross-cell selection covering the whole table emits the table", () => {
    expect(
      copyAcross(
        "| A | B |\n| --- | --- |\n| one | two |\n",
        { region: "A", offset: "start" },
        { region: "two", offset: "end" },
      ),
    ).toBe("| A | B |\n| --- | --- |\n| one | two |");
  });

  test("copy: header plus full body rows emits a smaller table", () => {
    expect(
      copyAcross(
        "| A | B |\n| --- | --- |\n| one | two |\n| three | four |\n| five | six |\n",
        { region: "A", offset: "start" },
        { region: "four", offset: "end" },
      ),
    ).toBe("| A | B |\n| --- | --- |\n| one | two |\n| three | four |");
  });

  test("copy: body rows without the header still degrades to nothing", () => {
    expect(
      copyAcross(
        "| A | B |\n| --- | --- |\n| one | two |\n| three | four |\n",
        { region: "one", offset: "start" },
        { region: "four", offset: "end" },
      ),
    ).toBeNull();
  });

  test("copy: cross-cell partial row selection still degrades to nothing", () => {
    // Row-slice table copy only supports header-first full rows. Partial rows
    // still degrade rather than emitting an ambiguous fragment.
    expect(
      copyAcross(
        "| A | B |\n| --- | --- |\n| one | two |\n",
        { region: "A", offset: 1 },
        { region: "B", offset: "end" },
      ),
    ).toBeNull();
  });

  test("paste: into an empty paragraph replaces it", () => {
    expect(
      pasteInto("\n", { region: "", offset: "start" }, "| A | B |\n| --- | --- |\n| 1 | 2 |\n"),
    ).toBe("| A | B |\n| --- | --- |\n| 1 | 2 |\n");
  });

  test("paste: copied header-first row slice inserts as a smaller table", () => {
    const md = copyAcross(
      "| A | B |\n| --- | --- |\n| one | two |\n| three | four |\n| five | six |\n",
      { region: "A", offset: "start" },
      { region: "four", offset: "end" },
    )!;

    expect(pasteInto("\n", { region: "", offset: "start" }, md))
      .toBe("| A | B |\n| --- | --- |\n| one | two |\n| three | four |\n");
  });

  test("paste: plain text into a cell inserts inline", () => {
    expect(
      pasteInto("| A | B |\n| --- | --- |\n| one | two |\n", { region: "one", offset: "end" }, " fish"),
    ).toBe("| A | B |\n| --- | --- |\n| one fish | two |\n");
  });

  test("paste: marked inlines into a cell stay inline with marks preserved", () => {
    // Table cells *are* inline regions — `inlines` fragments take the
    // single-region inline-splice path, not the structural fallback.
    expect(
      pasteInto("| A | B |\n| --- | --- |\n| one | two |\n", { region: "one", offset: "end" }, " *fish*"),
    ).toBe("| A | B |\n| --- | --- |\n| one *fish* | two |\n");
  });

  test("paste: list into a cell flattens to plain text and preserves the table", () => {
    // The list flattens to its plain-text projection; the table stays intact.
    expect(
      pasteInto("| A | B |\n| --- | --- |\n| one | two |\n", { region: "one", offset: "start" }, "- item\n"),
    ).toBe("| A | B |\n| --- | --- |\n| itemone | two |\n");
  });

  test("paste: heading into a cell flattens to the heading text", () => {
    expect(
      pasteInto("| A | B |\n| --- | --- |\n| one | two |\n", { region: "two", offset: "end" }, "\n## sub"),
    ).toBe("| A | B |\n| --- | --- |\n| one | twosub |\n");
  });

  test("paste: cross-region selection touching a table flattens the same way in reverse", () => {
    const state = setup("alpha\n\n| A | B |\n| --- | --- |\n| one | two |\n\nomega\n");
    const paragraph = getRegion(state, "alpha");
    const cell = getRegion(state, "one");
    const fragment = parseFragment("- x\n- y\n");
    const selected = setSelection(state, {
      anchor: { regionId: cell.id, offset: 1 },
      focus: { regionId: paragraph.id, offset: 2 },
    });
    const next = pasteFragment(selected, fragment, "- x\n- y\n");

    expect(next).not.toBeNull();
    expect(toMarkdown(next!)).toBe("alx\ny\n\nomega\n");
  });

  test("paste: text into a non-first row inserts inline", () => {
    expect(
      pasteInto(
        "| A | B |\n| --- | --- |\n| one | two |\n| three | four |\n",
        { region: "four", offset: "end" },
        "X",
      ),
    ).toBe("| A | B |\n| --- | --- |\n| one | two |\n| three | fourX |\n");
  });
});

describe("Code blocks", () => {
  test("copy: whole-region selection preserves the fence", () => {
    expect(copyWholeRegion("```ts\nconst x = 1;\n```\n", "const x = 1;"))
      .toBe("```ts\nconst x = 1;\n```");
  });

  test("paste: into an empty paragraph replaces it", () => {
    expect(pasteInto("\n", { region: "", offset: "start" }, "```\nfoo\n```\n"))
      .toBe("```\nfoo\n```\n");
  });

  test("paste: text into the middle of a code block inserts as source", () => {
    expect(pasteInto("```\nfoo bar\n```\n", { region: "foo bar", offset: 4 }, "X"))
      .toBe("```\nfoo Xbar\n```\n");
  });

  test("paste: markdown structure into a code block stays literal source", () => {
    // Inside a code block, markdown markers are just characters — the source
    // stays opaque to structural paste.
    expect(pasteInto("```\nfoo\n```\n", { region: "foo", offset: "end" }, "\n- item"))
      .toBe("```\nfoo\n- item\n```\n");
  });

  test("paste: italic markdown into a code block keeps the asterisks literal", () => {
    expect(pasteInto("```\nx\n```\n", { region: "x", offset: "end" }, "*y*"))
      .toBe("```\nx*y*\n```\n");
  });

  test("paste: cross-region selection touching a code block stays literal in reverse", () => {
    const state = setup("alpha\n\n```\ncode\n```\n\nomega\n");
    const paragraph = getRegion(state, "alpha");
    const code = getRegion(state, "code");
    const fragment = parseFragment("# H\n\npara\n");
    const selected = setSelection(state, {
      anchor: { regionId: code.id, offset: 2 },
      focus: { regionId: paragraph.id, offset: 2 },
    });
    const next = pasteFragment(selected, fragment, "# H\n\npara\n");

    expect(next).not.toBeNull();
    expect(toMarkdown(next!)).toBe("al# H\n\npara\n\n\n```\nde\n```\n\nomega\n");
  });
});

describe("Thematic breaks", () => {
  test("copy: cross-block selection through one round-trips", () => {
    expect(
      copyAcross(
        "alpha\n\n***\n\nbeta\n",
        { region: "alpha", offset: "start" },
        { region: "beta", offset: "end" },
      ),
    ).toBe("alpha\n\n***\n\nbeta");
  });

  test("paste: thematic break splits the paragraph cleanly", () => {
    expect(pasteInto("alpha beta\n", { region: "alpha beta", offset: 6 }, "***\n"))
      .toBe("alpha\n\n***\n\nbeta\n");
  });
});

describe("Cross-block / multi-root", () => {
  test("copy: cross-paragraph partial selection trims both endpoints", () => {
    expect(
      copyAcross(
        "alpha\n\nbeta\n",
        { region: "alpha", offset: 2 },
        { region: "beta", offset: 2 },
      ),
    ).toBe("pha\n\nbe");
  });

  test("copy: cross-block selection joins heading and paragraph", () => {
    expect(
      copyAcross(
        "# Heading\n\nParagraph body\n",
        { region: "Heading", offset: "start" },
        { region: "Paragraph body", offset: "end" },
      ),
    ).toBe("# Heading\n\nParagraph body");
  });

  test("copy: cross-root selection that ends mid-list trims the list", () => {
    expect(
      copyAcross(
        "Before\n\n- alpha\n- beta\n- gamma\n",
        { region: "Before", offset: "start" },
        { region: "beta", offset: "end" },
      ),
    ).toBe("Before\n\n- alpha\n- beta");
  });
});

describe("Round trips", () => {
  test("whole list → empty doc", () => {
    const md = copyAcross(
      "- one\n- two\n- three\n",
      { region: "one", offset: "start" },
      { region: "three", offset: "end" },
    )!;

    expect(pasteInto("\n", { region: "", offset: "start" }, md))
      .toBe("- one\n- two\n- three\n");
  });

  test("whole heading → empty list item replaces the destination", () => {
    // The empty list-item destination is wholly trimmed away — the heading
    // takes the root slot.
    const md = copyWholeRegion("# Heading\n", "Heading")!;

    expect(pasteInto("- \n", { region: "", offset: "start" }, md)).toBe("# Heading\n");
  });

  test("whole table → end of a paragraph", () => {
    const md = copyAcross(
      "| A | B |\n| --- | --- |\n| one | two |\n",
      { region: "A", offset: "start" },
      { region: "two", offset: "end" },
    )!;

    expect(pasteInto("Before\n", { region: "Before", offset: "end" }, md))
      .toBe("Before\n\n| A | B |\n| --- | --- |\n| one | two |\n");
  });

  test("whole blockquote → end of a paragraph", () => {
    const md = copyAcross(
      "> first\n>\n> second\n",
      { region: "first", offset: "start" },
      { region: "second", offset: "end" },
    )!;

    expect(pasteInto("Before\n", { region: "Before", offset: "end" }, md))
      .toBe("Before\n\n> first\n>\n> second\n");
  });

  test("whole list item → empty list item collapses the destination", () => {
    // Single-item list pasted into an empty list-item destination collapses
    // — no nested bullet, no duplication.
    const md = copyWholeRegion("- alpha\n- beta\n", "alpha")!;

    expect(pasteInto("- \n", { region: "", offset: "start" }, md)).toBe("- alpha\n");
  });

  test("marked partial slice → mid-list-item preserves the mark inline", () => {
    // Verifies the inline-fragment round trip: copy emits an `inlines`
    // payload, paste applies it via the inline-splice path, the marks
    // survive without splitting the destination's container.
    const md = copySubstring("Hello *italic world* trail\n", "Hello italic world trail", "italic world")!;

    expect(pasteInto("- alpha beta\n", { region: "alpha beta", offset: 6 }, md))
      .toBe("- alpha *italic world*beta\n");
  });
});

describe("Undo / redo", () => {
  test("structural paste collapses to one history step", () => {
    const initial = setup("Hello\n");
    const placed = placeAt(initial, getRegion(initial, "Hello"), "end");
    const pasted = pasteFragment(placed, parseFragment("\n- new\n"))!;

    expect(toMarkdown(pasted)).toBe("Hello\n\n- new\n");
    expect(toMarkdown(undo(pasted)!)).toBe("Hello\n");
    expect(toMarkdown(redo(undo(pasted)!)!)).toBe("Hello\n\n- new\n");
  });

  test("cross-region cut+paste round-trips through history", () => {
    const initial = setup("alpha\n\nbeta\n");
    const selected = setSelection(initial, {
      anchor: { regionId: getRegion(initial, "alpha").id, offset: 0 },
      focus: { regionId: getRegion(initial, "beta").id, offset: 4 },
    });
    const cut = deleteSelection(selected)!;

    expect(toMarkdown(cut)).toBe("\n");
    expect(toMarkdown(undo(cut)!)).toBe("alpha\n\nbeta\n");
  });
});

describe("Comments — clipboard repair", () => {
  test("copy never disturbs threads on the source state", () => {
    const state = withCommentOn(setup("Hello world\n"), "Hello world", "world");
    const before = liveCommentTexts(state);

    copySelection(selectIn(state, getRegion(state, "Hello world"), 0, 5));

    expect(liveCommentTexts(state)).toEqual(before);
  });

  test("structural paste in a different root preserves the thread", () => {
    const seeded = withCommentOn(setup("alpha\n\nbeta\n"), "beta", "beta");
    const next = pasteFragment(placeCaret(seeded, "alpha", "start"), parseFragment("- new\n"))!;

    expect(liveCommentTexts(next)).toEqual(["beta"]);
  });

  test("structural paste before a commented offset shifts the anchor correctly", () => {
    const seeded = withCommentOn(setup("Hello world\n"), "Hello world", "world");
    // Paste italic at offset 0 — content ahead of the comment shifts.
    const next = pasteFragment(placeCaret(seeded, "Hello world", "start"), parseFragment("*X*"))!;

    expect(liveCommentTexts(next)).toEqual(["world"]);
  });

  test("cross-region delete preserves a thread anchored before the cut range", () => {
    const seeded = withCommentOn(
      setup("alpha beta\n\ngamma delta\n"),
      "alpha beta",
      "alpha",
    );
    const selected = setSelection(seeded, {
      anchor: { regionId: getRegion(seeded, "alpha beta").id, offset: "alpha ".length },
      focus: { regionId: getRegion(seeded, "gamma delta").id, offset: "gamma ".length },
    });
    const cut = deleteSelection(selected)!;

    expect(liveCommentTexts(cut)).toEqual(["alpha"]);
  });

  test("clipboard markdown does not carry comment threads", () => {
    // Comments are anchored annotations on the document, not part of the
    // copied fragment — pasting elsewhere never restores them.
    const seeded = withCommentOn(setup("Hello world\n"), "Hello world", "world");
    const region = getRegion(seeded, "Hello world");
    const md = copyMarkdown(selectIn(seeded, region, 0, region.text.length))!;

    expect(md).toBe("Hello world");
    expect(md).not.toContain("comment");
  });
});

/* -------------------------------------------------------------------------- */
/* Helpers — capture the four shapes that almost every test above follows     */
/* -------------------------------------------------------------------------- */

type CaretPosition = number | "start" | "end";
type RangeAnchor = { region: string; offset: CaretPosition };

// Copy the entire content of a single region, identified by its text.
function copyWholeRegion(setupMd: string, regionText: string): string | null {
  const state = setup(setupMd);
  const region = getRegion(state, regionText);
  return copyMarkdown(selectIn(state, region, 0, region.text.length));
}

// Copy a literal substring inside a single region.
function copySubstring(setupMd: string, regionText: string, substring: string): string | null {
  const state = setup(setupMd);
  return copyMarkdown(selectSubstring(state, getRegion(state, regionText), substring));
}

// Copy a selection spanning two regions, with offsets that may be a number,
// "start" (0), or "end" (region.text.length).
function copyAcross(setupMd: string, from: RangeAnchor, to: RangeAnchor): string | null {
  const state = setup(setupMd);
  const fromRegion = getRegion(state, from.region);
  const toRegion = getRegion(state, to.region);
  const selected = setSelection(state, {
    anchor: { regionId: fromRegion.id, offset: resolveOffset(fromRegion, from.offset) },
    focus: { regionId: toRegion.id, offset: resolveOffset(toRegion, to.offset) },
  });
  return copyMarkdown(selected);
}

// Paste markdown source at a caret position and return the resulting
// document markdown. Throws if the paste returns null — assert no-op
// behavior with `pasteFragment` directly.
function pasteInto(setupMd: string, caret: RangeAnchor, source: string): string {
  return toMarkdown(pasteIntoState(setupMd, caret, source));
}

// Paste at a caret position and return the resulting state, for tests that
// need to inspect post-paste selection or comment state.
function pasteIntoState(setupMd: string, caret: RangeAnchor, source: string): EditorState {
  const state = setup(setupMd);
  const placed = placeAt(state, getRegion(state, caret.region), caret.offset);
  const fragment = parseFragment(source);
  const next = pasteFragment(placed, fragment, source);

  if (!next) {
    throw new Error(`pasteFragment unexpectedly returned null for source ${JSON.stringify(source)}`);
  }

  return next;
}

// Run the editor's copy command on a state and return its serialized
// markdown — the round-trip the component layer would put on the
// clipboard. Returns null when the selection has nothing to copy.
function copyMarkdown(state: EditorState): string | null {
  const fragment = copySelection(state);
  return fragment ? serializeFragment(fragment) : null;
}

// Read the focus selection back as `(regionText, offset)` for caret-placement
// assertions.
function caret(state: EditorState): { regionText: string | undefined; offset: number } {
  const region = state.documentIndex.regionIndex.get(state.selection.focus.regionId);
  return { regionText: region?.text, offset: state.selection.focus.offset };
}

// Convenience: place a caret at a region and return the state with selection
// applied. Used by comment/cut tests that need the original state to add a
// comment before manipulating the selection.
function placeCaret(state: EditorState, regionText: string, position: CaretPosition): EditorState {
  return placeAt(state, getRegion(state, regionText), position);
}

function resolveOffset(region: EditorRegion, position: CaretPosition): number {
  if (position === "start") return 0;
  if (position === "end") return region.text.length;
  return position;
}

// Add a comment thread anchored at the first occurrence of `quote` inside
// the region with `regionText`. Throws if the quote isn't found.
function withCommentOn(state: EditorState, regionText: string, quote: string): EditorState {
  const region = getRegion(state, regionText);
  const startOffset = region.text.indexOf(quote);

  if (startOffset === -1) {
    throw new Error(`Quote ${JSON.stringify(quote)} not found in region ${JSON.stringify(regionText)}`);
  }

  const next = addComment(
    state,
    { regionId: region.id, startOffset, endOffset: startOffset + quote.length },
    `comment-on-${quote}`,
  );

  if (!next) {
    throw new Error(`addComment failed for quote ${JSON.stringify(quote)}`);
  }

  return next;
}

// Quotes of the threads that currently resolve to a live range in `state`,
// preserving thread order. Threads that no longer match any container are
// implicitly excluded — that's the "did the comment survive the edit?" check.
function liveCommentTexts(state: EditorState): string[] {
  const commentState = getCommentState(state);
  const liveByIndex = new Map(commentState.liveRanges.map((range) => [range.threadIndex, range]));

  return commentState.threads
    .map((thread, index) => (liveByIndex.has(index) ? thread.quote : null))
    .filter((quote): quote is string => quote !== null);
}
