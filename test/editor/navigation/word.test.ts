import { describe, expect, test } from "bun:test";
import { createDocument, createParagraphTextBlock } from "@/document";
import { moveCaretByWord } from "@/editor/navigation";
import { createEditorState, setSelection } from "@/editor/state";
import { getPath, placeAt, setup } from "../helpers";

describe("Word navigation", () => {
  test("moves and extends the caret to word edges", () => {
    const state = setup("alpha beta gamma");
    const path = getPath(state, "alpha beta gamma");
    const placed = placeAt(state, path, "start");
    const moved = moveCaretByWord(placed, "wordEnd");
    const extended = moveCaretByWord(moved, "wordEnd", { extendSelection: true });

    expect(moved.selection.focus.offset).toBe("alpha".length);
    expect(extended.selection.anchor).toEqual(moved.selection.focus);
    expect(extended.selection.focus.offset).toBe("alpha beta".length);
    expect(extended.documentIndex).toBe(state.documentIndex);
  });

  test("moves to the next word", () => {
    const state = setup("alpha beta gamma");
    const path = getPath(state, "alpha beta gamma");
    const fromStart = moveCaretByWord(placeAt(state, path, 0), "nextWord");
    const fromInterior = moveCaretByWord(placeAt(state, path, 2), "nextWord");
    const fromLastWord = moveCaretByWord(placeAt(state, path, "alpha beta g".length), "nextWord");

    expect(fromStart.selection.focus.offset).toBe("alpha ".length);
    expect(fromInterior.selection.focus.offset).toBe("alpha ".length);
    expect(fromLastWord.selection.focus.offset).toBe(path.text.length);
  });

  test("moves to the next word directly in the next path", () => {
    const state = setup("alpha\n\nbeta gamma");
    const alpha = getPath(state, "alpha");
    const beta = getPath(state, "beta gamma");
    const moved = moveCaretByWord(placeAt(state, alpha, 2), "nextWord");
    const extended = moveCaretByWord(placeAt(state, alpha, 2), "nextWord", {
      extendSelection: true,
    });

    expect(moved.selection.focus).toEqual({ path: beta.path, offset: 0 });
    expect(extended.selection.anchor).toEqual({ path: alpha.path, offset: 2 });
    expect(extended.selection.focus).toEqual({ path: beta.path, offset: 0 });
  });

  test("moves to the next word through inline objects", () => {
    const state = setup("alpha ![alt](https://example.com/image.png) beta");
    const path = getPath(state, `alpha \uFFFC beta`);
    const objectStart = path.text.indexOf("\uFFFC");
    const betaStart = path.text.indexOf("beta");
    const toObject = moveCaretByWord(placeAt(state, path, 2), "nextWord");
    const pastObject = moveCaretByWord(placeAt(state, path, objectStart), "nextWord");

    expect(toObject.selection.focus.offset).toBe(objectStart);
    expect(pastObject.selection.focus.offset).toBe(betaStart);
  });

  test("uses the path edge when no next word or path exists", () => {
    const state = setup("alpha");
    const path = getPath(state, "alpha");
    const moved = moveCaretByWord(placeAt(state, path, 2), "nextWord");

    expect(moved.selection.focus.offset).toBe(path.text.length);
  });

  test("collapses existing word selections toward the movement direction", () => {
    const state = setup("alpha beta gamma");
    const path = getPath(state, "alpha beta gamma");
    const selected = setSelection(state, {
      anchor: { path: path.path, offset: "alpha beta".length },
      focus: { path: path.path, offset: "alpha".length },
    });

    expect(moveCaretByWord(selected, "previousWord").selection.focus.offset).toBe("alpha".length);
    expect(moveCaretByWord(selected, "wordEnd").selection.focus.offset).toBe("alpha beta".length);
  });

  test("moves by word across paths while skipping empty paths", () => {
    const state = createEditorState(
      createDocument([
        createParagraphTextBlock("alpha"),
        createParagraphTextBlock(""),
        createParagraphTextBlock("beta"),
      ]),
    );
    const alpha = getPath(state, "alpha");
    const beta = getPath(state, "beta");
    const forward = moveCaretByWord(placeAt(state, alpha, "end"), "wordEnd");
    const backward = moveCaretByWord(placeAt(state, beta, "start"), "previousWord");

    expect(forward.selection.focus).toEqual({ path: beta.path, offset: beta.text.length });
    expect(backward.selection.focus).toEqual({ path: alpha.path, offset: 0 });
  });

  test("uses path navigation for word gestures in block mode", () => {
    const state = setup("alpha beta\n\ngamma delta");
    const first = getPath(state, "alpha beta");
    const second = getPath(state, "gamma delta");
    const moved = moveCaretByWord(placeAt(state, first, 2), "wordEnd", { mode: "block" });

    expect(moved.selection.focus).toEqual({ path: second.path, offset: 0 });
  });
});
