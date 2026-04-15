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
} from "react";
import type { Editor, EditorStateChange } from "@/editor";
import { resolveEditorCommand, type EditorKeybinding } from "../lib/keybindings";
import { readSingleContainerSelectionText } from "../lib/selection";

type UseInputOptions = {
  editor: Editor;
  editorState: ReturnType<Editor["createState"]>;
  editorStateRef: RefObject<ReturnType<Editor["createState"]> | null>;
  getViewportRenderData: () => ReturnType<Editor["prepareViewport"]>;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  keybindings?: EditorKeybinding[];
  onActivity: () => void;
  onEditorStateChange: (stateChange: EditorStateChange | null) => void;
};

type InputEventHandlers = {
  onBeforeInput: (event: FormEvent<HTMLTextAreaElement | HTMLCanvasElement>) => void;
  onKeyDown: (event: ReactKeyboardEvent<HTMLCanvasElement | HTMLTextAreaElement>) => void;
};

type ClipboardHandlers = {
  onCopy: (event: ClipboardEvent<HTMLCanvasElement | HTMLTextAreaElement>) => void;
  onCut: (event: ClipboardEvent<HTMLCanvasElement | HTMLTextAreaElement>) => void;
  onPaste: (event: ClipboardEvent<HTMLCanvasElement | HTMLTextAreaElement>) => void;
};

type SharedInputHandlers = InputEventHandlers & ClipboardHandlers;

type InputHandlers = SharedInputHandlers & {
  onFocus: () => void;
  onInput: (event: FormEvent<HTMLTextAreaElement>) => void;
};

type CanvasHandlers = SharedInputHandlers & {
  onFocus: () => void;
};

type InputController = {
  canvasHandlers: CanvasHandlers;
  focus: () => void;
  inputHandlers: InputHandlers;
};

const inputContextWindow = 64;

export function useInput({
  editor,
  editorState,
  editorStateRef,
  getViewportRenderData,
  inputRef,
  keybindings,
  onActivity,
  onEditorStateChange,
}: UseInputOptions): InputController {
  const readCurrentState = () => editorStateRef.current ?? editorState;

  const applyStateChange = useEffectEvent((stateChange: EditorStateChange | null) => {
    if (!stateChange) {
      return;
    }

    onActivity();
    onEditorStateChange(stateChange);
  });

  const focus = useEffectEvent(() => {
    const input = inputRef.current;

    if (!input) {
      return;
    }

    const focusHiddenInput = () => {
      input.focus({
        preventScroll: true,
      });
      syncInputContext(input, readCurrentState());
    };
    const windowObject = input.ownerDocument.defaultView;

    focusHiddenInput();

    if (windowObject) {
      windowObject.requestAnimationFrame(() => {
        focusHiddenInput();
      });
    }
  });

  const applyNativeText = useEffectEvent((state: typeof editorState, value: string) => {
    const insertedText = stripSyncedInputPrefix(value, resolveInputPrefix(state));
    const segments = insertedText.replace(/\r\n/g, "\n").split(/(\n)/);
    let nextState = state;
    let animationStarted = false;
    let documentChanged = false;

    for (const segment of segments) {
      if (segment.length === 0) {
        continue;
      }

      const stateChange =
        segment === "\n"
          ? editor.insertLineBreak(nextState)
          : editor.insertText(nextState, segment);

      if (!stateChange) {
        continue;
      }

      nextState = stateChange.state;
      animationStarted ||= stateChange.animationStarted;
      documentChanged ||= stateChange.documentChanged;
    }

    return nextState === state
      ? null
      : {
          animationStarted,
          documentChanged,
          state: nextState,
        };
  });

  const handleBeforeInput = useEffectEvent(
    (event: FormEvent<HTMLTextAreaElement | HTMLCanvasElement>) => {
      const state = readCurrentState();
      const nativeEvent = event.nativeEvent as InputEvent;
      const deleteDirection = resolveDeleteDirection(nativeEvent.inputType);

      if (nativeEvent.inputType === "insertText") {
        if (!nativeEvent.data) {
          return;
        }

        event.preventDefault();
        applyStateChange(applyNativeText(state, nativeEvent.data));
        return;
      }

      if (isLineBreakInputType(nativeEvent.inputType)) {
        event.preventDefault();
        applyStateChange(editor.insertLineBreak(state));
        return;
      }

      if (deleteDirection === "backward") {
        event.preventDefault();
        applyStateChange(editor.deleteBackward(state));
        return;
      }

      if (deleteDirection === "forward") {
        event.preventDefault();
        applyStateChange(editor.deleteForward(state));
      }
    },
  );

  const handleInput = useEffectEvent((event: FormEvent<HTMLTextAreaElement>) => {
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
        editor,
        readCurrentState(),
        getViewportRenderData(),
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
      applyStateChange(editor.deleteSelection(state));
    },
  );

  const handlePaste = useEffectEvent(
    (event: ClipboardEvent<HTMLCanvasElement | HTMLTextAreaElement>) => {
      const pastedText = event.clipboardData.getData("text/plain");

      if (pastedText.length === 0) {
        return;
      }

      event.preventDefault();
      applyStateChange(editor.replaceSelection(readCurrentState(), pastedText));
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

  const sharedHandlers = {
    onBeforeInput: handleBeforeInput,
    onCopy: handleCopy,
    onCut: handleCut,
    onKeyDown: handleKeyDown,
    onPaste: handlePaste,
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
  state: ReturnType<Editor["createState"]>,
  maxLength = inputContextWindow,
) {
  const { anchor, focus } = state.selection;

  if (anchor.regionId !== focus.regionId || anchor.offset !== focus.offset) {
    return "";
  }

  const region = state.documentEditor.regionIndex.get(focus.regionId);

  if (!region) {
    return "";
  }

  return region.text.slice(Math.max(0, focus.offset - maxLength), focus.offset);
}

export function stripSyncedInputPrefix(value: string, prefix: string) {
  const syncedValue = stripInputSeed(value);

  return syncedValue.startsWith(prefix)
    ? syncedValue.slice(prefix.length)
    : syncedValue;
}

export function syncInputContext(
  input: HTMLTextAreaElement,
  state: ReturnType<Editor["createState"]>,
) {
  const prefix = resolveInputPrefix(state);
  const nextValue = `${INPUT_SEED}${prefix}`;

  input.value = nextValue;
  input.setSelectionRange(nextValue.length, nextValue.length);
}

function applyKeyboardEvent(
  editor: Editor,
  state: ReturnType<Editor["createState"]>,
  viewport: ReturnType<Editor["prepareViewport"]>,
  event: KeyboardEvent,
  keybindings?: EditorKeybinding[],
): EditorStateChange | null {
  if (event.key === "Delete") {
    return editor.deleteForward(state);
  }

  const command = resolveEditorCommand(event, keybindings);

  if (command) {
    if (command === "moveToLineStart" || command === "moveToLineEnd") {
      return editor.moveCaretToLineBoundary(
        state,
        viewport.layout,
        command === "moveToLineStart" ? "Home" : "End",
        event.shiftKey,
      );
    }

    switch (command) {
      case "insertLineBreak":
        return editor.insertLineBreak(state);
      case "deleteBackward":
        return editor.deleteBackward(state);
      case "indent":
        return editor.indent(state);
      case "dedent":
        return editor.dedent(state);
      case "moveListItemUp":
        return editor.moveListItemUp(state);
      case "moveListItemDown":
        return editor.moveListItemDown(state);
      case "toggleSelectionBold":
        return editor.toggleSelectionBold(state);
      case "toggleSelectionItalic":
        return editor.toggleSelectionItalic(state);
      case "toggleSelectionStrikethrough":
        return editor.toggleSelectionStrikethrough(state);
      case "toggleSelectionUnderline":
        return editor.toggleSelectionUnderline(state);
      case "toggleSelectionInlineCode":
        return editor.toggleSelectionInlineCode(state);
      case "undo":
        return editor.undo(state);
      case "redo":
        return editor.redo(state);
    }
  }

  if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
    return editor.moveCaretHorizontally(
      state,
      event.key === "ArrowLeft" ? -1 : 1,
      event.shiftKey,
    );
  }

  if (event.key === "ArrowUp" || event.key === "ArrowDown") {
    return editor.moveCaretVertically(
      state,
      viewport.layout,
      event.key === "ArrowUp" ? -1 : 1,
    );
  }

  if (event.key === "PageUp" || event.key === "PageDown") {
    return editor.moveCaretByViewport(
      state,
      viewport.layout,
      event.key === "PageUp" ? -1 : 1,
    );
  }

  if (event.key.length === 1 && !event.altKey && !event.ctrlKey && !event.metaKey) {
    return editor.insertText(state, event.key);
  }

  return null;
}
