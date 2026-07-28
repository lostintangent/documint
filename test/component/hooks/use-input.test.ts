import { expect, test } from "bun:test";
import {
  INPUT_SEED,
  applyKeyboardInputCommand,
  canApplyInputCommand,
  isLineBreakInputType,
  resolveDeleteInputCommand,
  stripInputSeed,
} from "@/component/hooks/useInput";
import { resolveEditorInputCommand } from "@/component/lib/keybindings";
import { resolveEditorWordBoundaryStyle } from "@/component/lib/platform";
import {
  createEditorLayoutState,
  createLayoutCache,
  resolveEditorTextAtPath,
} from "@/editor";
import type { EditorInputCommand } from "@/types";
import { getPath, placeAt, setup } from "@test/editor/helpers";

test("treats both paragraph and line-break input types as structural Enter", () => {
  // iOS Safari emits `insertLineBreak` for the virtual keyboard's Return
  // key regardless of modifier state, so the inputType cannot tell us
  // whether the user wanted a soft break here. Both must collapse to the
  // same structural-Enter route; soft breaks are reachable only via the
  // Shift+Enter keybinding on physical keyboards (handled by `keydown`).
  expect(isLineBreakInputType("insertParagraph")).toBe(true);
  expect(isLineBreakInputType("insertLineBreak")).toBe(true);
  expect(isLineBreakInputType("insertText")).toBe(false);
});

test("normalizes iOS-style backward delete input types", () => {
  expect(resolveDeleteInputCommand("deleteContentBackward")).toBe("deleteBackward");
  expect(resolveDeleteInputCommand("deleteComposedCharacterBackward")).toBe("deleteBackward");
  expect(resolveDeleteInputCommand("deleteSoftLineBackward")).toBe("deleteBackward");
  expect(resolveDeleteInputCommand("deleteHardLineBackward")).toBe("deleteBackward");
  expect(resolveDeleteInputCommand("deleteWordBackward")).toBe("deleteWordBackward");
});

test("normalizes forward delete input types", () => {
  expect(resolveDeleteInputCommand("deleteContentForward")).toBe("deleteForward");
  expect(resolveDeleteInputCommand("deleteSoftLineForward")).toBe("deleteForward");
  expect(resolveDeleteInputCommand("deleteHardLineForward")).toBe("deleteForward");
  expect(resolveDeleteInputCommand("deleteWordForward")).toBe("deleteWordForward");
});

test("ignores unrelated input types", () => {
  expect(resolveDeleteInputCommand("insertText")).toBeNull();
});

test("strips the hidden input seed from native text", () => {
  expect(stripInputSeed(`${INPUT_SEED}a${INPUT_SEED}b`)).toBe("ab");
  expect(stripInputSeed(INPUT_SEED)).toBe("");
});

test("accepts only selection commands in read-only mode", () => {
  const safeCommands = [
    "moveToDocumentEnd",
    "moveToDocumentStart",
    "moveToLineEnd",
    "moveToLineStart",
    "moveWordBackward",
    "moveWordForward",
    "selectAll",
  ] satisfies EditorInputCommand[];

  const mutatingCommands = [
    "dedent",
    "deleteBackward",
    "deleteForward",
    "deleteWordBackward",
    "deleteWordForward",
    "indent",
    "insertLineBreak",
    "insertSoftLineBreak",
    "moveListItemDown",
    "moveListItemUp",
    "redo",
    "toggleBold",
    "toggleCode",
    "toggleItalic",
    "toggleStrikethrough",
    "toggleSuperscript",
    "toggleUnderline",
    "undo",
  ] satisfies EditorInputCommand[];

  for (const command of safeCommands) {
    expect(canApplyInputCommand(command, true)).toBe(true);
  }

  for (const command of mutatingCommands) {
    expect(canApplyInputCommand(command, true)).toBe(false);
    expect(canApplyInputCommand(command, false)).toBe(true);
  }
});

test("routes platform word-forward gestures to their native boundary style", () => {
  const state = setup("alpha beta");
  const path = getPath(state, "alpha beta");
  const placed = placeAt(state, path, "start");
  const viewport = layoutAt(placed);
  const macEvent = createKeyboardEvent("ArrowRight", { altKey: true });
  const windowsEvent = createKeyboardEvent("ArrowRight", { ctrlKey: true });
  const otherEvent = createKeyboardEvent("ArrowRight", { ctrlKey: true });
  const macCommand = resolveEditorInputCommand(macEvent, undefined, "mac");
  const windowsCommand = resolveEditorInputCommand(windowsEvent, undefined, "windows");
  const otherCommand = resolveEditorInputCommand(otherEvent, undefined, "other");
  const macState = applyKeyboardInputCommand(
    placed,
    viewport,
    macEvent,
    macCommand,
    resolveEditorWordBoundaryStyle("mac"),
  );
  const windowsState = applyKeyboardInputCommand(
    placed,
    viewport,
    windowsEvent,
    windowsCommand,
    resolveEditorWordBoundaryStyle("windows"),
  );
  const otherState = applyKeyboardInputCommand(
    placed,
    viewport,
    otherEvent,
    otherCommand,
    resolveEditorWordBoundaryStyle("other"),
  );

  expect(macState?.selection.focus.offset).toBe("alpha".length);
  expect(windowsState?.selection.focus.offset).toBe("alpha ".length);
  expect(otherState?.selection.focus.offset).toBe("alpha".length);
});

test("routes Windows word-forward movement directly to the next path start", () => {
  const state = setup("alpha\n\nbeta");
  const alpha = getPath(state, "alpha");
  const beta = getPath(state, "beta");
  const placed = placeAt(state, alpha, "start");
  const event = createKeyboardEvent("ArrowRight", { ctrlKey: true });
  const command = resolveEditorInputCommand(event, undefined, "windows");
  const nextState = applyKeyboardInputCommand(
    placed,
    layoutAt(placed),
    event,
    command,
    "tokenStarts",
  );

  expect(nextState?.selection.focus).toEqual({ path: beta.path, offset: 0 });
});

test("routes word-forward deletion through the same platform boundary style", () => {
  const state = setup("alpha beta");
  const path = getPath(state, "alpha beta");
  const placed = placeAt(state, path, "start");
  const event = createKeyboardEvent("Delete", { ctrlKey: true });
  const windowsCommand = resolveEditorInputCommand(event, undefined, "windows");
  const otherCommand = resolveEditorInputCommand(event, undefined, "other");
  const windowsState = applyKeyboardInputCommand(
    placed,
    layoutAt(placed),
    event,
    windowsCommand,
    "tokenStarts",
  );
  const otherState = applyKeyboardInputCommand(
    placed,
    layoutAt(placed),
    event,
    otherCommand,
    "wordEdges",
  );

  expect(resolveEditorTextAtPath(windowsState!.documentIndex, path.path)).toBe("beta");
  expect(resolveEditorTextAtPath(otherState!.documentIndex, path.path)).toBe(" beta");
});

test("extends line-boundary selection with Shift+Home", () => {
  const state = setup("alpha beta");
  const path = getPath(state, "alpha beta");
  const placed = placeAt(state, path, "end");
  const event = createKeyboardEvent("Home", { shiftKey: true });
  const command = resolveEditorInputCommand(event, undefined, "windows");
  const nextState = applyKeyboardInputCommand(
    placed,
    layoutAt(placed),
    event,
    command,
    "tokenStarts",
  );

  expect(nextState?.selection.anchor).toEqual(placed.selection.focus);
  expect(nextState?.selection.focus).toEqual({ path: path.path, offset: 0 });
});

test.each([
  ["non-Mac Alt+Left", "ArrowLeft", { altKey: true }, "windows"],
  ["non-Mac Control+Up", "ArrowUp", { ctrlKey: true }, "other"],
  ["macOS Control+Right", "ArrowRight", { ctrlKey: true }, "mac"],
  ["combined modifiers", "ArrowRight", { ctrlKey: true, metaKey: true }, "windows"],
] as const)(
  "leaves unsupported modified arrow routing untouched for %s",
  (_label, key, modifiers, platform) => {
    const state = setup("alpha");
    const path = getPath(state, "alpha");
    const placed = placeAt(state, path, 2);
    const event = createKeyboardEvent(key, modifiers);
    const command = resolveEditorInputCommand(event, undefined, platform);

    expect(command).toBeNull();
    expect(
      applyKeyboardInputCommand(
        placed,
        layoutAt(placed),
        event,
        command,
        resolveEditorWordBoundaryStyle(platform),
      ),
    ).toBeNull();
  },
);

function layoutAt(state: ReturnType<typeof setup>) {
  return createEditorLayoutState(state, { height: 2_000, top: 0, width: 800 }, createLayoutCache());
}

function createKeyboardEvent(key: string, options: KeyboardEventInit = {}) {
  return {
    altKey: options.altKey ?? false,
    ctrlKey: options.ctrlKey ?? false,
    key,
    metaKey: options.metaKey ?? false,
    shiftKey: options.shiftKey ?? false,
  } as KeyboardEvent;
}
