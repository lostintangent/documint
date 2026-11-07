// Comment scenarios as a user meets them: comment on text, edit around it,
// save and reopen the file, and see where each comment shows.

import { describe, expect, test } from "bun:test";
import {
  getCommentState,
  hasActiveCommentHighlightsInViewport,
  resolveActiveCommentIndex,
} from "@/editor/anchors";
import {
  addComment,
  copySelection,
  createEditorLayoutState,
  createEditorState,
  deleteBackward,
  deleteThread,
  insertLineBreak,
  insertSoftLineBreak,
  insertTableColumn,
  insertTableRow,
  insertText,
  moveListItemDown,
  pasteFragment,
  redo,
  replyToThread,
  resolveThread,
  setSelection,
  undo,
  type EditorPresence,
  type EditorState,
} from "@/editor";
import { parseDocument, serializeDocument } from "@/markdown";
import { getMetadataEntry, indexedTextEntries, placeAt, selectSubstring, setup } from "../helpers";

type Gesture = (state: EditorState) => EditorState;

describe("creating a comment", () => {
  test.each<[string, string, string, string, [string, string] | null]>([
    ["a word", "Review surface\n", "Review", "  Looks good  ", ["Review", "Looks good"]],
    ["a mention", "Hello @[Jane Doe](user-123) world\n", "\uFFFC", "note", ["@Jane Doe", "note"]],
    ["an image without alt text", "See ![](a.png) now\n", "\uFFFC", "note", null],
    ["a word with a blank body", "Review surface\n", "Review", "  ", null],
  ])("comments on %s", (_, markdown, quote, body, saved) => {
    const state = setup(markdown);
    const next = addComment(state, rangeOf(state, quote), body);

    expect(
      next?.documentIndex.document.comments.map((thread) => [
        thread.quote,
        thread.comments[0]!.body,
      ]) ?? null,
    ).toEqual(saved && [saved]);
    expect(next?.selection ?? state.selection).toBe(state.selection);
  });

  test("refuses a comment on front matter text", () => {
    const state = setup("---\ntitle: Draft\n---\nBody\n");
    const { path } = getMetadataEntry(state, 0, "value");

    expect(addComment(state, { endOffset: 5, path, startOffset: 0 }, "note")).toBeNull();
  });

  test.each<[string, string, number, string]>([
    ["a mention", "Hello @[Jane Doe](user-123) world\n", 0, "0:6 \uFFFC"],
    [
      "a mention after an image",
      "See ![Preview](a.png) and @[Jane Doe](user-123) now\n",
      1,
      "0:10 \uFFFC",
    ],
    [
      "a mention in a table cell",
      "| H |\n| --- |\n| Cell @[Jane Doe](user-123) done |\n",
      0,
      "1:5 \uFFFC",
    ],
  ])(
    "shows a comment on %s where it was made, before and after a reopen",
    (_, markdown, occurrence, shown) => {
      const state = commentOn(setup(markdown), "\uFFFC", occurrence);

      expect(visibleComments(state)).toEqual([shown]);
      expect(visibleComments(reopen(state))).toEqual([shown]);
    },
  );
});

// Every row also reopens the saved file and expects the comment where it was.
describe("typing around a comment", () => {
  test.each<[string, string, string, Gesture, string]>([
    ["typing inside it", "abcd\n", "bc", steps(caretAt(0, 2), type("X")), "0:1 bXc"],
    [
      "a soft line break before it",
      "abcd\n",
      "bc",
      steps(caretAt(0, "start"), (state) => insertSoftLineBreak(state)!),
      "0:2 bc",
    ],
    [
      "typing before a mention",
      "Hello @[Jane Doe](user-123) world\n",
      "\uFFFC",
      steps(caretAt(0, "start"), type("Say ")),
      "0:10 \uFFFC",
    ],
    [
      "typing after it, where a copy of its sentence follows",
      "Say hello world.\n\nSay hello world.\n",
      "hello",
      steps(caretAfter("world"), type("s")),
      "0:4 hello",
    ],
    [
      "retyping a word before it and then deleting inside it",
      "Say hello world to the lazy dog.\n",
      "world",
      steps(select("hello"), type("hey"), caretAfter("worl"), backspace),
      "0:8 word",
    ],
    [
      "retyping both edges of a quote another paragraph repeats",
      "one world two\n\nthree world four\n",
      "world",
      steps(select("one"), type("uno"), select("two"), type("dos")),
      "0:4 world",
    ],
  ])("keeps a comment on its text after %s", (_, markdown, quote, gesture, shown) => {
    const state = gesture(commentOn(setup(markdown), quote));

    expect(visibleComments(state)).toEqual([shown]);
    expect(visibleComments(reopen(state))).toEqual([shown]);
  });
});

// Once an edit deletes a comment's last character, text typed right at its
// end extends the comment, until another edit closes the run. Every row also
// reopens the saved file and expects the comment where it was.
describe("open comment end", () => {
  const sentence = "Say hello world to you.\n";

  test.each<[string, string, Gesture, string, (string | null)?]>([
    ["retyping it mid-sentence", sentence, steps(select("world"), type("planet")), "0:10 planet"],
    [
      "retyping it at a paragraph end",
      "Say hello world\n",
      steps(select("world"), type("planet")),
      "0:10 planet",
    ],
    [
      "deleting it and then typing",
      sentence,
      steps(select("world"), backspace, type("planet")),
      "0:10 planet",
    ],
    [
      "replacing a selection that runs past its end",
      "Say hello world and more.\n",
      steps(select("ld and"), type("ms")),
      "0:10 worms",
    ],
    [
      "replacing a selection that runs into the next paragraph",
      "Say hello world and\n\nmore text\n",
      steps((state) => {
        const [start, end] = indexedTextEntries(state);
        return setSelection(state, {
          anchor: { offset: start!.text.indexOf("ld"), path: start!.path },
          focus: { offset: "more".length, path: end!.path },
        });
      }, type("ms")),
      "0:10 worms",
    ],
    [
      "backspacing at its end and retyping",
      sentence,
      steps(caretAfter("world"), backspace, type("d")),
      "0:10 world",
    ],
    [
      "retyping it after an inline image",
      "Say ![pic](a.png) hello world.\n",
      steps(select("world"), type("planet")),
      "0:12 planet",
    ],
    [
      "undoing to the middle of a retype and typing on",
      sentence,
      steps(select("world"), type("pla"), undo, type("x")),
      "0:10 plx",
    ],
    ["typing right after it", sentence, steps(caretAfter("world"), type("s")), "0:10 world"],
    [
      "typing elsewhere before typing at its end again",
      `${sentence}\nOther\n`,
      steps(
        select("world"),
        type("p"),
        caretAt(1, "end"),
        type("x"),
        caretAfter("p"),
        type("lanet"),
      ),
      "0:10 p",
    ],
    [
      "deleting it, typing elsewhere, and typing where it was",
      `${sentence}\nOther\n`,
      steps(
        select("world"),
        backspace,
        caretAt(1, "end"),
        type("x"),
        caretAfter("hello "),
        type("planet"),
      ),
      "0:16",
    ],
    // Saved with context on one side only, the empty quote can't be found
    // again, so it hides on reopen.
    [
      "deleting it at a paragraph end and typing elsewhere",
      "Say hello world\n\nOther\n",
      steps(select("world"), backspace, caretAt(1, "end"), type("x")),
      "0:10",
      null,
    ],
  ])("covers the right text after %s", (_, markdown, gesture, shown, reopenedShown = shown) => {
    const state = gesture(commentOn(setup(markdown), "world"));

    expect(visibleComments(state)).toEqual([shown]);
    expect(visibleComments(reopen(state))).toEqual([reopenedShown]);
  });

  test("keeps a thread and its replies when its quote is deleted and the file reopened", () => {
    const commented = replyToThread(commentOn(setup(sentence), "world"), 0, "reply")!;
    const reopened = reopen(steps(select("world"), backspace)(commented));

    expect(reopened.documentIndex.document.comments).toMatchObject([
      { comments: [{ body: "note" }, { body: "reply" }], quote: "" },
    ]);
    expect(visibleComments(reopened)).toEqual(["0:10"]);
  });
});

// Resolution alone can't tell these quotes apart, so each comment stays on
// its own text only because its match carries forward from the snapshot that
// created it.
describe("carried comment matches", () => {
  const headings = "# Same\n\n# Same\n\nOther\n";
  const cells = "| A | B |\n| --- | --- |\n| Yes | Yes |\n";
  const enter: Gesture = (state) => insertLineBreak(state)!;

  test.each<[string, string, string, Gesture, string[]]>([
    [
      "a heading after typing in another paragraph",
      headings,
      "Same",
      steps(caretAt(2, "end"), type("x")),
      ["1:0 Same"],
    ],
    [
      "a table cell after typing in another cell",
      cells,
      "Yes",
      steps(caretAt(0, "end"), type("x")),
      ["3:0 Yes"],
    ],
    [
      "a heading after a paragraph is added above it",
      headings,
      "Same",
      steps(caretAt(0, "end"), enter),
      ["2:0 Same"],
    ],
    [
      "a heading after a copy of it is pasted at its start",
      headings,
      "Same",
      (state) =>
        pasteFragment(caretAt(1, "start")(state), copySelection(select("Same", 1)(state))!)!,
      ["2:0 Same"],
    ],
    [
      "a table cell after the other cell is commented too",
      cells,
      "Yes",
      (state) => commentOn(state, "Yes"),
      ["3:0 Yes", "2:0 Yes"],
    ],
    [
      "a table cell after an earlier thread is deleted",
      cells,
      "Yes",
      (state) => deleteThread(commentOn(state, "Yes"), 0)!,
      ["2:0 Yes"],
    ],
    [
      "a heading after a reply and a resolve",
      headings,
      "Same",
      (state) => resolveThread(replyToThread(state, 0, "reply")!, 0, true)!,
      ["1:0 Same (resolved)"],
    ],
  ])("keeps a comment on %s", (_, markdown, quote, gesture, shown) => {
    expect(visibleComments(gesture(commentOn(setup(markdown), quote, 1)))).toEqual(shown);
  });

  // These edits rebuild the commented node's parent and shift its path, but
  // keep the node itself.
  test.each<[string, string, Gesture, string]>([
    [
      "a table row is inserted above it",
      "| H |\n| --- |\n| Yes |\n| Yes |\n",
      steps(caretAt(2, "start"), (state) => insertTableRow(state, "above")!),
      "3:0 Yes",
    ],
    [
      "a table column is inserted to its left",
      cells,
      steps(caretAt(3, "start"), (state) => insertTableColumn(state, "left")!),
      "5:0 Yes",
    ],
    ["a list item is added above it", "- Yes\n- Yes\n", steps(caretAt(0, "end"), enter), "2:0 Yes"],
    [
      "a quote paragraph is added above it",
      "> Yes\n>\n> Yes\n",
      steps(caretAt(0, "end"), enter),
      "2:0 Yes",
    ],
  ])("keeps a comment on its moved text when %s", (_, markdown, gesture, shown) => {
    const state = commentOn(setup(markdown), "Yes", 1);
    const moved = gesture(state);

    expect(visibleComments(moved)).toEqual([shown]);
    expect(visibleComments(undo(moved))).toEqual(visibleComments(state));
    expect(visibleComments(redo(undo(moved)))).toEqual([shown]);
  });

  test("restores a comment's exact state through undo and redo", () => {
    const commented = commentOn(setup("Say hello world.\n\nSay hello world.\n"), "world", 1);
    const retyped = steps(select("world", 1), type("there"))(commented);
    const undone = [..."there"].reduce<EditorState>((state) => undo(state), retyped);
    const redone = [..."there"].reduce<EditorState>((state) => redo(state), undone);

    expect(undone.documentIndex.document).toBe(commented.documentIndex.document);
    expect(getCommentState(undone.documentIndex)).toBe(getCommentState(commented.documentIndex));
    expect(visibleComments(retyped)).toEqual(["1:10 there"]);
    expect(getCommentState(redone.documentIndex)).toBe(getCommentState(retyped.documentIndex));
  });

  test("shows the saved threads themselves when no comment needs repair", () => {
    const { documentIndex } = commentOn(setup("alpha beta\n"), "alpha");

    expect(getCommentState(documentIndex).threads).toBe(documentIndex.document.comments);
  });

  // When an identical quote takes over the commented text's old path, the
  // comment never moves onto it.
  test.each<[string, string, string, number, Gesture, string]>([
    [
      "its paragraph merges into the one above",
      "hello\n\nworld\n\nworld\n",
      "world",
      0,
      steps(caretAt(1, "start"), backspace),
      "1:0 world",
    ],
    [
      "a table row is inserted above the identical cell",
      "| A |\n| --- |\n| Yes |\n| Yes |\n",
      "Yes",
      1,
      steps(caretAt(1, "start"), (state) => insertTableRow(state, "above")!),
      "2:0 Yes",
    ],
  ])(
    "doesn't move a comment onto an identical quote when %s",
    (_, markdown, quote, occurrence, gesture, wrong) => {
      expect(visibleComments(gesture(commentOn(setup(markdown), quote, occurrence)))).not.toContain(
        wrong,
      );
    },
  );
});

// Carry tells identical copies apart within a session, and the saved
// occurrence tells them apart across a reopen. Every row saves the committed
// Document, as the component does, reopens it, and expects the same saved
// comments back.
describe("saved occurrence", () => {
  const cells = (...texts: string[]) =>
    `| ${texts.map((_, index) => `H${index}`).join(" | ")} |\n|${" --- |".repeat(texts.length)}\n| ${texts.join(" | ")} |\n`;
  const commented = (markdown: string, quote: string, occurrence: number) => () =>
    commentOn(setup(markdown), quote, occurrence);
  // A file whose one comment saved `anchor` for `quote`.
  const saved = (markdown: string, quote: string, anchor: Record<string, unknown>) => () =>
    setup(
      `${markdown}\n:::documint-comments\n${JSON.stringify([
        { anchor, comments: [{ body: "note", updatedAt: "2026-04-05T12:00:00.000Z" }], quote },
      ])}\n:::\n`,
    );
  const unchanged: Gesture = (state) => state;

  test.each<[string, () => EditorState, Gesture, number | undefined, string | null]>([
    [
      "a comment on the second of two identical cells",
      commented(cells("Yes", "Yes"), "Yes", 1),
      unchanged,
      2,
      "3:0 Yes",
    ],
    ["a unique comment", commented("Yes\n\nNo\n", "Yes", 0), unchanged, undefined, "0:0 Yes"],
    [
      "a comment after a reply and a resolve",
      commented(cells("Yes", "Yes"), "Yes", 1),
      (state) => resolveThread(replyToThread(state, 0, "reply")!, 0, true)!,
      2,
      "3:0 Yes (resolved)",
    ],
    [
      "a comment after a copy is pasted before it",
      commented(cells("No", "Yes"), "Yes", 0),
      pasteOver("Yes", "No"),
      2,
      "3:0 Yes",
    ],
    [
      "a comment after an earlier copy is retyped",
      commented(cells("Yes", "Yes", "Yes"), "Yes", 2),
      steps(select("Yes", 3), type("No")),
      2,
      "5:0 Yes",
    ],
    [
      "a comment after its only other copy is retyped",
      commented(cells("Yes", "Yes"), "Yes", 1),
      steps(select("Yes", 2), type("No")),
      undefined,
      "3:0 Yes",
    ],
    [
      "a comment after a typo fix makes it a copy",
      commented(cells("Yes", "Yse"), "Yse", 0),
      steps(select("Yse", 3), type("Yes")),
      2,
      "3:0 Yes",
    ],
    [
      "a comment after its list item moves past a copy",
      commented("- Yes\n- Yes\n- No\n", "Yes", 0),
      steps(caretAt(0, "start"), (state) => moveListItemDown(state)!),
      2,
      "1:0 Yes",
    ],
    [
      "a comment after a table row is inserted above it",
      commented("| H |\n| --- |\n| Yes |\n| Yes |\n", "Yes", 1),
      steps(caretAt(2, "start"), (state) => insertTableRow(state, "above")!),
      2,
      "3:0 Yes",
    ],
    [
      "a comment among overlapping copies",
      commented(`${"a".repeat(60)}\n`, "a", 30),
      unchanged,
      7,
      "0:30 a",
    ],
    [
      "a comment after a leading space in a quote",
      () => commentOn(steps(caretAt(0, "start"), type(" "))(setup("> Yes\n\nSay Yes\n")), "Yes", 0),
      unchanged,
      1,
      "0:1 Yes",
    ],
    [
      "a reply that saves a repaired anchor",
      saved("Say Yes\n\nSay Yes\n", "Yes", { occurrence: 2, prefix: "y " }),
      (state) => replyToThread(state, 0, "reply")!,
      2,
      "1:4 Yes",
    ],
    [
      "a comment whose occurrence is out of range",
      saved(cells("Yes", "Yes"), "Yes", { kind: "tableCell", occurrence: 3 }),
      unchanged,
      3,
      null,
    ],
    [
      "a paste that brings an unresolved occurrence into range",
      saved(cells("Yes", "Yes", "No"), "Yes", { kind: "tableCell", occurrence: 3 }),
      pasteOver("Yes", "No"),
      undefined,
      null,
    ],
    [
      "a comment whose quote is gone and whose context ties",
      saved("a X b\n\na Y b\n", "Z", { occurrence: 1, prefix: "a ", suffix: " b" }),
      unchanged,
      1,
      null,
    ],
  ])("saves and reopens %s", (_, start, gesture, occurrence, shown) => {
    const state = gesture(start());
    const reopened = reopen(state);

    expect(state.documentIndex.document.comments.map(({ anchor }) => anchor.occurrence)).toEqual([
      occurrence,
    ]);
    expect(visibleComments(state)).toEqual([shown]);
    expect(visibleComments(reopened)).toEqual([shown]);
    expect(serializeDocument(reopened.documentIndex.document)).toBe(
      serializeDocument(state.documentIndex.document),
    );
  });
});

// The file was edited outside the editor, so the comment shows on the
// repaired text, while the file keeps the anchor it saved until the user
// changes the comment.
describe("a reopened comment whose text was edited outside the editor", () => {
  const opened = () =>
    reopen(commentOn(setup("Say hello world to you.\n\nOther\n"), "hello world"), (markdown) =>
      markdown.replace("hello world to", "hello big world to"),
    );

  test.each<[string, Gesture, string]>([
    ["opening it", (state) => state, "hello world"],
    ["typing in another paragraph", steps(caretAt(1, "end"), type("x")), "hello world"],
    [
      "pasting a copy of its paragraph over another",
      pasteOver("Say hello big world to you.", "Other"),
      "hello world",
    ],
    ["replying to it", (state) => replyToThread(state, 0, "reply")!, "hello big world"],
  ])("shows the repaired quote after %s", (_, gesture, savedQuote) => {
    const state = gesture(opened());

    expect(visibleComments(state)).toEqual(["0:4 hello big world"]);
    expect(getCommentState(state.documentIndex).threads[0]!.quote).toBe("hello big world");
    expect(state.documentIndex.document.comments[0]!.quote).toBe(savedQuote);
  });
});

describe("active comment", () => {
  // The comment covers "lph" in "alpha". Points are [text path order, offset].
  test.each<[string, [number, number], [number, number], number | null]>([
    ["a caret at its start", [0, 1], [0, 1], 0],
    ["a caret inside it", [0, 2], [0, 2], 0],
    ["a caret at its end", [0, 4], [0, 4], 0],
    ["a caret just before it", [0, 0], [0, 0], null],
    ["a caret just after it", [0, 5], [0, 5], null],
    ["a selection that touches its end", [0, 4], [0, 7], null],
    ["a selection that overlaps its end", [0, 3], [0, 7], 0],
    ["a backward selection from the next paragraph into it", [1, 2], [0, 2], 0],
  ])("for %s", (_, anchor, focus, expected) => {
    const state = commentOn(setup("alpha beta\n\ngamma\n"), "lph");
    const point = ([index, offset]: [number, number]) => ({
      offset,
      path: indexedTextEntries(state)[index]!.path,
    });
    const selected = setSelection(state, { anchor: point(anchor), focus: point(focus) });

    expect(resolveActiveCommentIndex(selected, getCommentState(state.documentIndex).ranges)).toBe(
      expected,
    );
  });

  test("animates a highlight only while someone is on its unresolved comment", () => {
    const presence = new Map<number, EditorPresence>([
      [
        0,
        {
          commentThreadIndex: 0,
          cursorPoint: null,
          id: "user",
          isOnUnresolvedCommentThread: true,
          username: "User",
          viewport: null,
        },
      ],
    ]);
    const isAnimated = (state: EditorState) =>
      hasActiveCommentHighlightsInViewport(
        createEditorLayoutState(state, { height: 320, top: 0, width: 520 }),
        getCommentState(state.documentIndex).ranges,
        presence,
      );
    const state = commentOn(setup("Review surface anchors survive.\n"), "surface");

    expect(isAnimated(state)).toBe(true);
    expect(isAnimated(resolveThread(state, 0, true)!)).toBe(false);
  });
});

// --- Helpers ---

// The `occurrence`-th match of `quote`, counting overlapping matches across
// text paths in document order.
function rangeOf(state: EditorState, quote: string, occurrence = 0) {
  let remaining = occurrence;

  for (const { path, text } of indexedTextEntries(state)) {
    for (let start = text.indexOf(quote); start !== -1; start = text.indexOf(quote, start + 1)) {
      if (remaining-- === 0) {
        return { endOffset: start + quote.length, path, startOffset: start };
      }
    }
  }

  throw new Error(`Expected occurrence ${occurrence} of "${quote}"`);
}

function commentOn(state: EditorState, quote: string, occurrence = 0) {
  return addComment(state, rangeOf(state, quote, occurrence), "note")!;
}

// Saves the committed Document, as the component does, lets `editFile` change
// the file outside the editor, and opens it again.
function reopen(state: EditorState, editFile = (markdown: string) => markdown) {
  return createEditorState(
    parseDocument(editFile(serializeDocument(state.documentIndex.document))),
  );
}

// What the editor shows for each thread: where its highlight starts, as
// "<text path order>:<offset>", then the highlighted text, marked when
// resolved. `null` when the thread shows nowhere.
function visibleComments(state: EditorState) {
  const entries = indexedTextEntries(state);
  const { ranges, threads } = getCommentState(state.documentIndex);
  const shown: (string | null)[] = threads.map(() => null);

  for (const { endOffset, path, resolved, startOffset, threadIndex } of ranges) {
    const index = entries.findIndex((entry) => entry.path === path);
    const text = entries[index]!.text.slice(startOffset, endOffset);

    expect(endOffset).toBeGreaterThanOrEqual(startOffset);

    shown[threadIndex] =
      `${index}:${startOffset}${text && ` ${text}`}${resolved ? " (resolved)" : ""}`;
  }

  return shown;
}

// --- Gestures ---
// Each addresses text by its order among the editor's text paths.

function steps(...gestures: Gesture[]): Gesture {
  return (state) => gestures.reduce((next, gesture) => gesture(next), state);
}

function select(text: string, index = 0): Gesture {
  return (state) => selectSubstring(state, indexedTextEntries(state)[index]!, text);
}

function caretAt(index: number, offset: number | "end" | "start"): Gesture {
  return (state) => placeAt(state, indexedTextEntries(state)[index]!, offset);
}

function caretAfter(text: string, index = 0): Gesture {
  return (state) => {
    const entry = indexedTextEntries(state)[index]!;
    return placeAt(state, entry, entry.text.indexOf(text) + text.length);
  };
}

// Types one keystroke at a time.
function type(text: string): Gesture {
  return (state) => [...text].reduce((next, character) => insertText(next, character)!, state);
}

function backspace(state: EditorState) {
  return deleteBackward(state)!;
}

// Copies the first text path that is exactly `source` and pastes it over the
// first that is exactly `target`, in one commit.
function pasteOver(source: string, target: string): Gesture {
  return (state) => {
    const entries = indexedTextEntries(state);
    const copy = copySelection(
      selectSubstring(
        state,
        entries.find(({ text }) => text === source)!,
        source,
      ),
    )!;

    return pasteFragment(
      selectSubstring(
        state,
        entries.find(({ text }) => text === target)!,
        target,
      ),
      copy,
    )!;
  };
}
