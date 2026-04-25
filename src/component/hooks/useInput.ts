// Owns the hidden browser input bridge used to:
// - open the software keyboard on mobile
// - receive browser text, keyboard, IME, and clipboard events
// - translate those native events into semantic editor operations
import {
  type ClipboardEvent,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  deleteBackward,
  deleteForward,
  deleteSelection,
  insertLineBreak,
  insertText,
  measureVisualCaretTarget,
  moveCaretByViewport,
  moveCaretHorizontally,
  moveCaretToDocumentBoundary,
  moveCaretToLineBoundary,
  moveCaretVertically,
  replaceSelection,
  setSelection,
  dedent,
  indent,
  moveListItemDown,
  moveListItemUp,
  redo,
  selectAll,
  toggleBold,
  toggleInlineCode,
  toggleItalic,
  toggleStrikethrough,
  toggleUnderline,
  undo,
  type EditorSelectionPoint,
  type EditorState,
  type EditorViewportState,
} from "@/editor";
import type { LazyRefHandle } from "./useLazyRef";
import { resolveEditorCommand, type EditorKeybinding } from "../lib/keybindings";
import { readSingleContainerSelectionText } from "../lib/selection";

type UseInputOptions = {
  editorState: EditorState;
  editorStateRef: RefObject<EditorState | null>;
  editorViewportState: LazyRefHandle<EditorViewportState>;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  keybindings?: EditorKeybinding[];
  onActivity: () => void;
  onEditorStateChange: (nextState: EditorState | null) => void;
};

type ClipboardHandlers = {
  onCopy: (event: ClipboardEvent<HTMLCanvasElement | HTMLTextAreaElement>) => void;
  onCut: (event: ClipboardEvent<HTMLCanvasElement | HTMLTextAreaElement>) => void;
  onPaste: (event: ClipboardEvent<HTMLCanvasElement | HTMLTextAreaElement>) => void;
};

// `onKeyDown` is optional because we deliberately omit it on touch-primary
// devices — the mere presence of a keydown listener on the hidden textarea
// bridge causes iOS Safari to suppress `autocapitalize` (and likely other
// keyboard-intelligence features). Soft keyboards don't fire keydown, so
// nothing is lost on mobile.
//
// NOTE: `onBeforeInput` is intentionally absent. React's synthetic
// `onBeforeInput` is wired to the legacy WebKit `textInput` event, not the
// modern native `beforeinput`, so it does not fire at all for delete
// operations on iOS Safari. We attach a native `beforeinput` listener on
// the textarea directly (see the `useEffect` in `useInput`).
type SharedInputHandlers = ClipboardHandlers & {
  onKeyDown?: (event: ReactKeyboardEvent<HTMLCanvasElement | HTMLTextAreaElement>) => void;
};

type InputHandlers = SharedInputHandlers & {
  onFocus: () => void;
  onInput: (event: FormEvent<HTMLTextAreaElement>) => void;
};

type CanvasHandlers = SharedInputHandlers & {
  onFocus: () => void;
};

type InputController = {
  canvasHandlers: CanvasHandlers;
  focus: (targetPoint?: EditorSelectionPoint) => void;
  inputHandlers: InputHandlers;
};

// Maximum characters kept in the hidden textarea before the caret, providing
// context for IME composition and browser autocorrect.
const INPUT_CONTEXT_WINDOW = 64;

export function useInput({
  editorState,
  editorStateRef,
  editorViewportState,
  inputRef,
  keybindings,
  onActivity,
  onEditorStateChange,
}: UseInputOptions): InputController {
  const isTouchPrimary = useIsTouchPrimary();
  const readCurrentState = () => editorStateRef.current ?? editorState;
  // When `primingRef.current === true`, the bridge is in the middle of
  // execCommand-ing a dummy insert+delete to seed iOS's UIUndoManager so
  // that Shake-to-Undo and related gestures dispatch `historyUndo`
  // beforeinput events (they only fire when the UA has undo history).
  // While this flag is set we skip `handleBeforeInput` / `handleInput` so
  // our own logic doesn't preventDefault the priming execCommands.
  const primingRef = useRef(false);
  const undoStackPrimedRef = useRef(false);

  const applyStateChange = useEffectEvent((nextState: EditorState | null) => {
    if (!nextState) {
      return;
    }

    onActivity();
    onEditorStateChange(nextState);
  });

  const runUndoStackPrime = useEffectEvent(() => {
    const input = inputRef.current;
    if (!input) return;
    if (typeof document === "undefined") return;
    // `document.execCommand` is deprecated but still works on iOS Safari and
    // — critically — its insert/delete operations *are* recorded in
    // UIUndoManager (whereas assigning to `input.value` is not). Do one
    // insert + delete pair so iOS has something to undo on shake.
    const execCommand = (document as Document & {
      execCommand?: (command: string, showUI?: boolean, value?: string) => boolean;
    }).execCommand;
    if (typeof execCommand !== "function") return;
    try {
      primingRef.current = true;
      execCommand.call(document, "insertText", false, "‌");
      execCommand.call(document, "delete");
    } catch {
      // If the priming throws (e.g. Safari rejects execCommand in some
      // sandbox), undo via gesture just won't work — which is the same as
      // the pre-fix state.
    } finally {
      primingRef.current = false;
      // Restore the textarea to its canonical shape in case the exec'd
      // insertion/deletion left any residue.
      syncInputContext(input, readCurrentState());
    }
  });

  const primeUndoStack = useEffectEvent(() => {
    if (undoStackPrimedRef.current) return;
    undoStackPrimedRef.current = true;
    runUndoStackPrime();
  });

  // After handling an iOS-originated historyUndo/historyRedo, run a fresh
  // priming pass. iOS's UIUndoManager advances its internal pointer even
  // when the handler preventDefaults, so without re-priming it would offer
  // "Redo" on the next shake instead of continuing to offer "Undo" —
  // decoupled from our editor's deeper undo stack, which may still have
  // more steps to roll back.
  const rePrimeUndoStack = useEffectEvent(() => {
    runUndoStackPrime();
  });

  // Move the hidden textarea so its bounding rect overlays the visible
  // caret. Inspired by CodeMirror's model: textarea is `position: absolute`
  // (inherited from CSS) as a direct child of the scrollable ancestor, so
  // iOS's "scroll focused input into view" behavior naturally scrolls the
  // scroll-container to reveal the caret when the keyboard appears.
  const positionInputAtPoint = useEffectEvent((point: EditorSelectionPoint) => {
    if (!isTouchPrimary) return;
    const input = inputRef.current;
    if (!input) return;

    const viewport = editorViewportState.get();
    const caret = measureVisualCaretTarget(readCurrentState(), viewport, point);
    if (!caret) return;

    input.style.top = `${caret.top}px`;
    input.style.left = `${caret.left}px`;

    // Match the caret's vertical extent so iOS scrolls the entire caret row
    // above the keyboard, not just its top pixel. Width stays at the static
    // 2px from CSS — horizontal scroll-into-view isn't meaningful for a
    // caret, and the CSS already satisfies iOS's 2x2 minimum (see comment
    // on .documint-input).
    input.style.height = `${caret.height}px`;
  });

  const focus = useEffectEvent((targetPoint?: EditorSelectionPoint) => {
    const input = inputRef.current;

    if (!input) {
      return;
    }

    // Always position the hidden textarea at the caret before asking the
    // browser for focus — iOS decides whether/where to scroll based on the
    // focused element's bounding rect at focus time, and React's re-render
    // (which would otherwise update the position via `useLayoutEffect`)
    // runs too late. If the caller knows the target selection — e.g., the
    // hit point from a pointer tap that just called `setSelection` but
    // whose update hasn't flushed yet — it can pass it explicitly;
    // otherwise we use the current render's selection focus.
    positionInputAtPoint(targetPoint ?? readCurrentState().selection.focus);

    // On desktop, prevent the browser from scrolling to the textarea
    // (it may be at a stale position before layout effects update it).
    // On touch, allow it — iOS uses focus-time scroll to shift content
    // above the virtual keyboard.
    input.focus({ preventScroll: !isTouchPrimary });
    syncInputContext(input, readCurrentState());

    // First focus is also where we seed iOS's undo manager.
    primeUndoStack();
  });

  const applyNativeText = useEffectEvent((state: typeof editorState, value: string) => {
    const insertedText = stripSyncedInputPrefix(value, resolveInputPrefix(state));
    const segments = insertedText.replace(/\r\n/g, "\n").split(/(\n)/);
    let nextState = state;

    for (const segment of segments) {
      if (segment.length === 0) {
        continue;
      }

      const result =
        segment === "\n"
          ? insertLineBreak(nextState)
          : insertText(nextState, segment);

      if (!result) {
        continue;
      }

      nextState = result;
    }

    return nextState === state ? null : nextState;
  });

  const applyReplacementText = useEffectEvent(
    (state: typeof editorState, charsToDelete: number, replacement: string) => {
      // Build a selection covering the range to be replaced (the
      // `charsToDelete` characters immediately before the caret) and
      // delegate to `replaceSelection`, which dispatches a single action
      // — one undo entry, one animation tick — instead of N delete + M
      // insert operations.
      const focusPoint = state.selection.focus;
      const anchor = {
        regionId: focusPoint.regionId,
        offset: Math.max(0, focusPoint.offset - charsToDelete),
      };
      const extended = setSelection(state, { anchor, focus: focusPoint });
      return replaceSelection(extended, replacement);
    },
  );

  const handleBeforeInput = useEffectEvent((event: InputEvent) => {
    if (primingRef.current) return;
    const state = readCurrentState();
    const deleteDirection = resolveDeleteDirection(event.inputType);

    if (event.inputType === "insertText") {
      if (!event.data) {
        return;
      }

      event.preventDefault();
      applyStateChange(applyNativeText(state, event.data));
      return;
    }

    if (event.inputType === "insertReplacementText") {
      // iOS autocorrect: replaces a range already in the textarea (typically
      // the word immediately before the caret) with `event.data`. The range
      // is communicated via the textarea's selectionStart/End at the time
      // the beforeinput fires. Because our synced textarea value mirrors
      // the editor text up to the caret, deleting the range length from the
      // editor is equivalent to deleting the same chars before the caret.
      if (!event.data) {
        return;
      }
      event.preventDefault();
      const target = event.target as HTMLTextAreaElement | null;
      const selStart = target?.selectionStart ?? 0;
      const selEnd = target?.selectionEnd ?? selStart;
      const charsToReplace = Math.max(0, selEnd - selStart);
      applyStateChange(applyReplacementText(state, charsToReplace, event.data));
      return;
    }

    if (isLineBreakInputType(event.inputType)) {
      event.preventDefault();
      applyStateChange(insertLineBreak(state));
      return;
    }

    if (deleteDirection === "backward") {
      event.preventDefault();
      applyStateChange(deleteBackward(state));
      return;
    }

    if (deleteDirection === "forward") {
      event.preventDefault();
      applyStateChange(deleteForward(state));
      return;
    }

    if (event.inputType === "historyUndo") {
      // iOS Shake-to-Undo (and three-finger swipe-left, and external keyboard
      // ⌘Z) dispatches `beforeinput` with this inputType when the UA has
      // undo history for the element. We redirect to the editor's own undo
      // stack, which is the true source of truth for document state. Then
      // we re-prime so iOS keeps offering "Undo" on the next gesture rather
      // than flipping to "Redo".
      event.preventDefault();
      applyStateChange(undo(state));
      rePrimeUndoStack();
      return;
    }

    if (event.inputType === "historyRedo") {
      event.preventDefault();
      applyStateChange(redo(state));
      rePrimeUndoStack();
      return;
    }
  });

  const handleInput = useEffectEvent((event: FormEvent<HTMLTextAreaElement>) => {
    if (primingRef.current) return;
    const state = readCurrentState();
    const value = event.currentTarget.value;

    if (stripSyncedInputPrefix(value, resolveInputPrefix(state)).length === 0) {
      syncInputContext(event.currentTarget, state);
      return;
    }

    applyStateChange(applyNativeText(state, value));
  });

  const handleKeyDown = useEffectEvent(
    (event: ReactKeyboardEvent<HTMLCanvasElement | HTMLTextAreaElement>) => {
      const stateChange = applyKeyboardEvent(
        readCurrentState(),
        editorViewportState.get(),
        event.nativeEvent,
        keybindings,
      );

      if (!stateChange) {
        return;
      }

      event.preventDefault();
      applyStateChange(stateChange);
    },
  );

  const handleCopy = useEffectEvent(
    (event: ClipboardEvent<HTMLCanvasElement | HTMLTextAreaElement>) => {
      const selectedText = readSingleContainerSelectionText(readCurrentState());

      if (!selectedText) {
        return;
      }

      event.preventDefault();
      event.clipboardData.setData("text/plain", selectedText);
    },
  );

  const handleCut = useEffectEvent(
    (event: ClipboardEvent<HTMLCanvasElement | HTMLTextAreaElement>) => {
      const state = readCurrentState();
      const selectedText = readSingleContainerSelectionText(state);

      if (!selectedText) {
        return;
      }

      event.preventDefault();
      event.clipboardData.setData("text/plain", selectedText);
      applyStateChange(deleteSelection(state));
    },
  );

  const handlePaste = useEffectEvent(
    (event: ClipboardEvent<HTMLCanvasElement | HTMLTextAreaElement>) => {
      const pastedText = event.clipboardData.getData("text/plain");

      if (pastedText.length === 0) {
        return;
      }

      event.preventDefault();
      applyStateChange(replaceSelection(readCurrentState(), pastedText));
    },
  );

  const handleInputFocus = useEffectEvent(() => {
    onActivity();
    const input = inputRef.current;

    if (input) {
      syncInputContext(input, readCurrentState());
    }
  });

  const handleCanvasFocus = useEffectEvent(() => {
    onActivity();
    focus();
  });

  useEffect(() => {
    const input = inputRef.current;

    if (!input) {
      return;
    }

    syncInputContext(input, editorState);
  }, [editorState, inputRef]);

  // Keep the hidden textarea positioned at the visible caret's pixel
  // coordinates so that mobile browsers' "scroll focused input into view
  // when the virtual keyboard appears" heuristic targets the right spot.
  // See `positionInputAtPoint` for details. Uses a layout effect so
  // positioning lands before the browser paints.
  useLayoutEffect(() => {
    positionInputAtPoint(editorState.selection.focus);
  }, [editorState, positionInputAtPoint]);

  // React's synthetic `onBeforeInput` prop wires to the legacy WebKit
  // `textInput` event, which does NOT fire for delete operations on iOS
  // Safari (and is unreliable across browsers in general). Attach a native
  // listener for the modern `beforeinput` event directly on the textarea so
  // that deletions, line breaks, and insertions are all routed through the
  // bridge consistently.
  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    const listener = (event: Event) => handleBeforeInput(event as InputEvent);
    input.addEventListener("beforeinput", listener);
    return () => input.removeEventListener("beforeinput", listener);
  }, [inputRef, handleBeforeInput]);

  const sharedHandlers: SharedInputHandlers = {
    onCopy: handleCopy,
    onCut: handleCut,
    onPaste: handlePaste,
    ...(isTouchPrimary ? {} : { onKeyDown: handleKeyDown }),
  };

  return {
    canvasHandlers: {
      ...sharedHandlers,
      onFocus: handleCanvasFocus,
    },
    focus,
    inputHandlers: {
      ...sharedHandlers,
      onFocus: handleInputFocus,
      onInput: handleInput,
    },
  };
}

export const INPUT_SEED = "\u200b";

// Returns true on devices whose primary input is a coarse pointer (touch
// screens on phones and tablets). Used to decide whether to attach a keydown
// listener to the input bridge — iOS Safari (and likely other WebKit-based
// touch browsers) suppress `autocapitalize` and related keyboard-intelligence
// features on text inputs that have a keydown listener directly attached, and
// soft keyboards don't fire keydown events anyway, so the desktop-only
// keyboard-shortcut path is simply skipped on touch-primary devices.
function useIsTouchPrimary(): boolean {
  const [isTouchPrimary, setIsTouchPrimary] = useState(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return false;
    }
    return window.matchMedia("(pointer: coarse)").matches;
  });

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }
    const mediaQuery = window.matchMedia("(pointer: coarse)");
    const onChange = (event: MediaQueryListEvent) => setIsTouchPrimary(event.matches);
    mediaQuery.addEventListener?.("change", onChange);
    return () => mediaQuery.removeEventListener?.("change", onChange);
  }, []);

  return isTouchPrimary;
}

export function isLineBreakInputType(inputType: string) {
  return inputType === "insertLineBreak" || inputType === "insertParagraph";
}

export function resolveDeleteDirection(inputType: string) {
  switch (inputType) {
    case "deleteContentBackward":
    case "deleteComposedCharacterBackward":
    case "deleteSoftLineBackward":
    case "deleteHardLineBackward":
    case "deleteWordBackward":
      return "backward";
    case "deleteContentForward":
    case "deleteSoftLineForward":
    case "deleteHardLineForward":
    case "deleteWordForward":
      return "forward";
    default:
      return null;
  }
}

export function stripInputSeed(value: string) {
  return value.replaceAll(INPUT_SEED, "");
}

export function resolveInputPrefix(
  state: EditorState,
  maxLength = INPUT_CONTEXT_WINDOW,
) {
  const { anchor, focus } = state.selection;

  if (anchor.regionId !== focus.regionId || anchor.offset !== focus.offset) {
    return "";
  }

  const region = state.documentIndex.regionIndex.get(focus.regionId);

  if (!region) {
    return "";
  }

  return region.text.slice(Math.max(0, focus.offset - maxLength), focus.offset);
}

export function stripSyncedInputPrefix(value: string, prefix: string) {
  const syncedValue = stripInputSeed(value);

  return syncedValue.startsWith(prefix) ? syncedValue.slice(prefix.length) : syncedValue;
}

// Syncs the hidden textarea to mirror the editor state around the caret.
// The value is composed of two parts:
//
//   INPUT_SEED (zero-width space) — ensures the textarea is never truly
//   empty, so browsers always fire beforeinput for backspace/delete even
//   when the caret is at the start of a region with no preceding text.
//
//   prefix (up to INPUT_CONTEXT_WINDOW chars before the caret) — gives
//   the IME and browser autocorrect enough surrounding context to offer
//   accurate suggestions and completions.
//
// The caret is placed at the end so new input appends after the prefix.
export function syncInputContext(
  input: HTMLTextAreaElement,
  state: EditorState,
) {
  const prefix = resolveInputPrefix(state);
  const nextValue = `${INPUT_SEED}${prefix}`;

  input.value = nextValue;
  input.setSelectionRange(nextValue.length, nextValue.length);
}

function applyKeyboardEvent(
  state: EditorState,
  viewport: EditorViewportState,
  event: KeyboardEvent,
  keybindings?: EditorKeybinding[],
): EditorState | null {
  if (event.key === "Delete") {
    return deleteForward(state);
  }

  const command = resolveEditorCommand(event, keybindings);

  if (command) {
    if (command === "moveToLineStart" || command === "moveToLineEnd") {
      return moveCaretToLineBoundary(
        state,
        viewport.layout,
        command === "moveToLineStart" ? "Home" : "End",
        event.shiftKey,
      );
    }

    if (command === "moveToDocumentStart" || command === "moveToDocumentEnd") {
      return moveCaretToDocumentBoundary(
        state,
        command === "moveToDocumentStart" ? "start" : "end",
        event.shiftKey,
      );
    }

    switch (command) {
      case "insertLineBreak":
        return insertLineBreak(state);
      case "deleteBackward":
        return deleteBackward(state);
      case "indent":
        return indent(state);
      case "dedent":
        return dedent(state);
      case "moveListItemUp":
        return moveListItemUp(state);
      case "moveListItemDown":
        return moveListItemDown(state);
      case "toggleBold":
        return toggleBold(state);
      case "toggleItalic":
        return toggleItalic(state);
      case "toggleStrikethrough":
        return toggleStrikethrough(state);
      case "toggleUnderline":
        return toggleUnderline(state);
      case "toggleInlineCode":
        return toggleInlineCode(state);
      case "undo":
        return undo(state);
      case "redo":
        return redo(state);
      case "selectAll":
        return selectAll(state);
    }
  }

  if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
    return moveCaretHorizontally(state, event.key === "ArrowLeft" ? -1 : 1, event.shiftKey);
  }

  if (event.key === "ArrowUp" || event.key === "ArrowDown") {
    return moveCaretVertically(
      state,
      viewport.layout,
      event.key === "ArrowUp" ? -1 : 1,
      event.shiftKey,
    );
  }

  if (event.key === "PageUp" || event.key === "PageDown") {
    return moveCaretByViewport(
      state,
      viewport.layout,
      event.key === "PageUp" ? -1 : 1,
      event.shiftKey,
    );
  }

  if (event.key.length === 1 && !event.altKey && !event.ctrlKey && !event.metaKey) {
    return insertText(state, event.key);
  }

  return null;
}
