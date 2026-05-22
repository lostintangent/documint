import {
  type ClipboardEvent,
  type FocusEvent,
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
  copySelection,
  deleteBackward,
  deleteForward,
  deleteSelection,
  insertLineBreak,
  insertLink,
  insertSoftLineBreak,
  insertImage,
  insertText,
  measureVisualCaretTarget,
  moveCaretByViewport,
  moveCaretHorizontally,
  moveCaretToDocumentBoundary,
  moveCaretToLineBoundary,
  moveCaretVertically,
  pasteFragment,
  replaceTextRange,
  dedent,
  indent,
  moveListItemDown,
  moveListItemUp,
  redo,
  selectAll,
  toggleCode,
  toggleMark,
  undo,
  type EditorLayoutState,
  type EditorSelectionPoint,
  type EditorState,
} from "@/editor";
import type { EditorInputCommand } from "@/types";
import { parseFragment, serializeFragment } from "@/markdown";
import { emitDiagnostic, useDiagnostics } from "../lib/diagnostics";
import { resolveEditorInputCommand, type EditorInputKeybinding } from "../lib/keybindings";
import {
  editorStateSprig,
  useDocumintStore,
  useEditorCommand,
  useSprig,
  type EditorStateTransition,
} from "../store";

type UseInputOptions = {
  // DOM refs the hook reads from.
  inputRef: RefObject<HTMLTextAreaElement | null>;

  keybindings?: EditorInputKeybinding[];

  // Host callbacks the hook invokes.
  onActivity: () => void;
  // Optional pre-handlers for transient UI such as completions. Return true
  // after handling an event to prevent the editor's normal input routing.
  //
  // Touch-primary devices normally omit keydown to preserve iOS
  // autocapitalization, but transient UI may need it while visible to consume
  // Return before the OS advances sentence capitalization state.
  enableTouchKeyDown?: boolean;
  onBeforeInput?: (event: InputEvent) => boolean;
  onKeyDown?: (event: ReactKeyboardEvent<HTMLCanvasElement | HTMLTextAreaElement>) => boolean;
  // Invoked when the clipboard contains an image and the host has agreed
  // to persist it. Receives the pasted file (carrying blob bytes, MIME
  // type, and the originating filename when available), returns the path
  // (or URL) to splice into the document via a markdown image reference.
  // Return `null` to swallow the paste.
  onImagePaste?: (file: File) => Promise<string | null>;
};

// Imperative focus signal exposed to other hooks (usePointer, useSelection)
// for "open the keyboard at this caret position" intent. Defined here so all
// consumers share a single canonical type.
export type FocusInput = (point?: EditorSelectionPoint) => void;

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
  onFocus: (event: FocusEvent<HTMLTextAreaElement>) => void;
  onInput: (event: FormEvent<HTMLTextAreaElement>) => void;
};

type CanvasHandlers = SharedInputHandlers & {
  onFocus: (event: FocusEvent<HTMLCanvasElement>) => void;
};

type InputController = {
  canvasHandlers: CanvasHandlers;
  focus: FocusInput;
  inputHandlers: InputHandlers;
};

type KeyboardCommandHandlerInput = {
  event: KeyboardEvent;
  state: EditorState;
  viewport: EditorLayoutState;
};

type KeyboardCommandHandler = (input: KeyboardCommandHandlerInput) => EditorState | null;

const keyboardCommandHandlers = {
  dedent: ({ state }) => dedent(state),
  deleteBackward: ({ state }) => deleteBackward(state),
  indent: ({ state }) => indent(state),
  insertLineBreak: ({ state }) => insertLineBreak(state),
  insertSoftLineBreak: ({ state }) => insertSoftLineBreak(state),
  moveListItemDown: ({ state }) => moveListItemDown(state),
  moveListItemUp: ({ state }) => moveListItemUp(state),
  moveToDocumentEnd: ({ event, state }) =>
    moveCaretToDocumentBoundary(state, "end", event.shiftKey),
  moveToDocumentStart: ({ event, state }) =>
    moveCaretToDocumentBoundary(state, "start", event.shiftKey),
  moveToLineEnd: ({ event, state, viewport }) =>
    moveCaretToLineBoundary(state, viewport, "End", event.shiftKey),
  moveToLineStart: ({ event, state, viewport }) =>
    moveCaretToLineBoundary(state, viewport, "Home", event.shiftKey),
  redo: ({ state }) => redo(state),
  selectAll: ({ state }) => selectAll(state),
  toggleBold: ({ state }) => toggleMark(state, "bold"),
  toggleCode: ({ state }) => toggleCode(state),
  toggleItalic: ({ state }) => toggleMark(state, "italic"),
  toggleStrikethrough: ({ state }) => toggleMark(state, "strikethrough"),
  toggleSuperscript: ({ state }) => toggleMark(state, "superscript"),
  toggleUnderline: ({ state }) => toggleMark(state, "underline"),
  undo: ({ state }) => undo(state),
} satisfies Record<EditorInputCommand, KeyboardCommandHandler>;

// Maximum characters kept in the hidden textarea before the caret, providing
// context for IME composition, browser autocorrect, and — critically — voice
// dictation.
//
// Voice dictation on iOS revises previous partial transcriptions by firing
// `insertText` with the textarea's selection extended over the previous
// partial's range (see the doc block on `handleBeforeInput`). The selection
// is communicated via DOM offsets, so the *entire* current partial must fit
// inside the textarea — otherwise the OS can't extend `selectionStart`
// backward far enough and gives up sending live updates, then dumps the full
// transcript on session end (causing duplication, see the dictation flush
// heuristic in `handleBeforeInput`). Sized generously to cover long
// dictated paragraphs without truncation.
const INPUT_CONTEXT_WINDOW = 1024;

// Minimum overlap (in chars) required for the dictation flush heuristic to
// dedupe a collapsed `insertText` against the editor's text before the
// caret. Set high enough that plain typing and short IME commits never trip
// it, but low enough to catch real flushes (which are typically full
// sentences or paragraphs).
const DICTATION_FLUSH_OVERLAP_THRESHOLD = 16;

/**
 * Owns the hidden browser input bridge — a 2x2 absolutely-positioned
 * `<textarea>` that the editor uses to talk to the operating system.
 *
 * What this hook owns:
 *   - Receiving native text input via `beforeinput` (insertions, deletions,
 *     line breaks, autocorrect replacements) and routing it to editor
 *     operations.
 *   - Keyboard shortcut handling on desktop (omitted on touch — see comment
 *     on `SharedInputHandlers`).
 *   - Clipboard (copy / cut / paste) on both the textarea and the canvas.
 *   - IME / autocapitalize / autocorrect compatibility (the textarea is the
 *     OS-visible input, so it must look real to iOS Safari).
 *   - iOS Shake-to-Undo: priming `UIUndoManager` so the gesture fires
 *     `beforeinput` with `historyUndo`/`historyRedo`, which we route to the
 *     editor's own undo stack.
 *   - Imperative `focus({offset, regionId})` — positions the textarea at the
 *     caret pixel coordinates first (so iOS scrolls the right area into view
 *     above the keyboard) and then calls `.focus()`.
 *   - The `:focus-visible` guard on canvas focus that bridges Tab-key focus
 *     to the textarea while ignoring pointer-driven canvas focus (which
 *     would otherwise open the keyboard on every tap).
 *
 * Contract with the host:
 *   - The host renders a hidden `<textarea ref={inputRef}>` inside the
 *     scroll container (positioning is owned here, but mounting is the
 *     host's responsibility).
 *   - The host spreads `inputHandlers` onto the textarea and `canvasHandlers`
 *     onto the canvas. They overlap on clipboard so either DOM target works
 *     as a paste target.
 *   - Other hooks (usePointer, useSelection) call `focus()` directly when
 *     they want the keyboard up; the host wires `input.focus` into them.
 *   - The host doesn't own input state — it lives entirely in the textarea
 *     value and the editor state, both managed here.
 */
export function useInput({
  inputRef,
  keybindings,
  enableTouchKeyDown = false,
  onActivity,
  onBeforeInput,
  onKeyDown,
  onImagePaste,
}: UseInputOptions): InputController {
  /* Internal state */

  const store = useDocumintStore();
  const editorState = useSprig(editorStateSprig);
  const isTouchPrimary = useIsTouchPrimary();
  const readCurrentState = () => store.editor.getState();
  // When `primingRef.current === true`, the bridge is in the middle of
  // execCommand-ing a dummy insert+delete to seed iOS's UIUndoManager so
  // that Shake-to-Undo and related gestures dispatch `historyUndo`
  // beforeinput events (they only fire when the UA has undo history).
  // While this flag is set we skip `handleBeforeInput` / `handleInput` so
  // our own logic doesn't preventDefault the priming execCommands.
  const primingRef = useRef(false);
  const undoStackPrimedRef = useRef(false);
  const insertNativeText = useEditorCommand(insertNativeTextCommand);
  const replaceNativeText = useEditorCommand(replaceNativeTextCommand);
  const insertLineBreakCommand = useEditorCommand(insertLineBreak);
  const deleteBackwardCommand = useEditorCommand(deleteBackward);
  const deleteForwardCommand = useEditorCommand(deleteForward);
  const undoCommand = useEditorCommand(undo);
  const redoCommand = useEditorCommand(redo);
  const applyKeyboardInput = useEditorCommand(applyKeyboardInputCommand);
  const deleteSelectionCommand = useEditorCommand(deleteSelection);
  const insertImageCommand = useEditorCommand(insertImage);
  const insertLinkCommand = useEditorCommand(insertLink);
  const pasteFragmentCommand = useEditorCommand(pasteFragment);

  const runInputCommand = useEffectEvent(
    <Args extends unknown[]>(
      command: (...args: Args) => EditorStateTransition | null,
      ...args: Args
    ) => {
      const transition = command(...args);
      if (transition) {
        onActivity();
      }
      return transition;
    },
  );

  /* iOS UIUndoManager priming */

  const runUndoStackPrime = useEffectEvent(() => {
    const input = inputRef.current;
    if (!input) return;
    // `document.execCommand` is deprecated but still works on iOS Safari and
    // — critically — its insert/delete operations *are* recorded in
    // UIUndoManager (whereas assigning to `input.value` is not). Do one
    // insert + delete pair so iOS has something to undo on shake.
    const execCommand = (
      document as Document & {
        execCommand?: (command: string, showUI?: boolean, value?: string) => boolean;
      }
    ).execCommand;
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

  /* Caret positioning + focus */

  // Move the hidden textarea so that it's positioned directly beneath
  // the virtual cursor on the canvas. This is important for two reasons:
  //   1. iOS/mobile auto-scroll: the OS scrolls the focused input into
  //      view when the virtual keyboard appears.
  //   2. iOS/desktop caret-adjacent UI: autocorrect popovers, IME
  //      composition windows, and the dictation indicator anchor to the
  //      input's box instead of the scroll container's top-left corner.
  const positionInputAtPoint = useEffectEvent((point: EditorSelectionPoint) => {
    const input = inputRef.current;
    if (!input) return;

    const layout = store.layout.get();
    const caret = measureVisualCaretTarget(readCurrentState(), layout, point);
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

  /* Native event handlers (beforeinput / input / keydown) */

  /**
   * Maps native `beforeinput` event types to editor operations.
   *
   * # Mental model: replacement vs. insertion
   *
   * The OS uses TWO `inputType`s to communicate "replace the last N
   * chars before the caret with `data`", and the distinction is OS-
   * initiated vs. user-initiated:
   *
   *   - `insertReplacementText` — the OS unilaterally fixed something
   *     (iOS autocorrect, macOS Text Replacements, spellcheck).
   *   - `insertText` with a non-collapsed textarea selection — the user
   *     directly requested a swap (iOS suggestion-bar tap, voice
   *     dictation revising a partial).
   *
   * Both ultimately call `replaceNativeText`. The replacement range
   * is signaled by the textarea's `selectionStart` / `selectionEnd`,
   * which the OS extends over the to-be-replaced range right before
   * firing the event. Honoring that selection is what distinguishes a
   * replacement from an append (the original "duplication" bug surfaced
   * when we ignored it for the user-initiated path).
   *
   * # Branch taxonomy
   *
   *   - `insertText` non-collapsed → user-initiated replacement.
   *   - `insertText` collapsed, `data` overlaps editor tail → voice
   *     dictation FLUSH (session end OR partial outgrew the bridge).
   *     iOS dumps the full transcript without remembering what was
   *     already streamed; we insert only the non-overlapping suffix
   *     (see `detectDictationFlushOverlap`).
   *   - `insertText` collapsed, no overlap → plain typing / IME commit
   *     / autocomplete. Routed through `insertNativeText` (handles
   *     embedded `\n`).
   *   - `insertReplacementText` → OS-initiated replacement.
   *   - `insertLineBreak` / `insertParagraph` → `insertLineBreak`
   *     (structural Enter; iOS conflates the two so we can't split them
   *     here — see `isLineBreakInputType`).
   *   - `delete*` → `deleteBackward` / `deleteForward` (see
   *     `resolveDeleteDirection`).
   *   - `historyUndo` / `historyRedo` → editor undo stack, plus iOS
   *     UIUndoManager re-priming so the gesture keeps offering "Undo".
   *
   * # Composition events
   *
   * `compositionstart` / `compositionupdate` / `compositionend` are NOT
   * handled here — empirical testing confirmed iOS voice dictation
   * doesn't use them, and IME compositions reach the editor via the
   * `input` event path through `insertNativeText`.
   */
  const handleBeforeInput = useEffectEvent((event: InputEvent) => {
    if (process.env.NODE_ENV !== "production") {
      const target = event.target as HTMLTextAreaElement | null;
      emitDiagnostic("beforeinput", {
        inputType: event.inputType,
        data: event.data,
        dataLength: event.data?.length ?? null,
        isComposing: event.isComposing,
        targetRanges:
          event.getTargetRanges?.()?.map((range) => ({
            startOffset: range.startOffset,
            endOffset: range.endOffset,
            collapsed: range.startOffset === range.endOffset,
          })) ?? [],
        selectionStart: target?.selectionStart ?? null,
        selectionEnd: target?.selectionEnd ?? null,
        taValue: target?.value ?? null,
        taValueLength: target?.value.length ?? null,
      });
    }

    if (primingRef.current) return;

    if (onBeforeInput?.(event)) {
      return;
    }

    const state = readCurrentState();
    const deleteDirection = resolveDeleteDirection(event.inputType);

    if (event.inputType === "insertText") {
      if (!event.data) return;
      event.preventDefault();

      // User-initiated replacement (suggestion-bar tap, dictation revision):
      // textarea selection extended over the range to replace.
      const range = resolveReplacementRange(event.target);
      if (range.charsToReplace > 0) {
        runInputCommand(replaceNativeText, range.charsToReplace, range.trailingOffset, event.data);
        return;
      }

      // Dictation FLUSH: collapsed selection, but `data` overlaps content
      // already committed. Insert only the non-overlapping suffix.
      const overlap = detectDictationFlushOverlap(state, event.data);
      if (overlap > 0) {
        const suffix = event.data.slice(overlap);
        if (suffix.length > 0) {
          runInputCommand(insertNativeText, suffix);
        }
        return;
      }

      // Plain typing / IME commit / autocomplete.
      runInputCommand(insertNativeText, event.data);
      return;
    }

    if (event.inputType === "insertReplacementText") {
      // OS-initiated replacement (autocorrect, Text Replacements,
      // spellcheck). Same selection-based mechanics as the
      // user-initiated `insertText` path above; see JSDoc.
      if (!event.data) return;
      event.preventDefault();
      const range = resolveReplacementRange(event.target);
      runInputCommand(replaceNativeText, range.charsToReplace, range.trailingOffset, event.data);
      return;
    }

    if (isLineBreakInputType(event.inputType)) {
      // Treat both `insertParagraph` and `insertLineBreak` inputTypes as
      // structural Enter here. iOS Safari emits `insertLineBreak` for the
      // virtual keyboard's Return key regardless of any modifier state, so
      // the inputType alone can't tell us whether the user wanted a soft
      // break. Soft breaks are still reachable on desktop via the Shift+
      // Enter keybinding — `keydown` fires first on physical keyboards
      // and preventDefaults the corresponding beforeinput before this
      // branch sees it. Touch-primary devices intentionally don't get a
      // soft-break gesture (consistent with Notion, Docs, etc.).
      event.preventDefault();
      runInputCommand(insertLineBreakCommand);
      return;
    }

    if (deleteDirection === "backward") {
      event.preventDefault();
      runInputCommand(deleteBackwardCommand);
      return;
    }

    if (deleteDirection === "forward") {
      event.preventDefault();
      runInputCommand(deleteForwardCommand);
      return;
    }

    // iOS Shake-to-Undo, three-finger swipe-left, and external-keyboard ⌘Z
    // all dispatch these inputTypes when the UA has undo history for the
    // textarea. Redirect to the editor's own undo stack, then re-prime so
    // iOS keeps offering "Undo" rather than flipping to "Redo" (its
    // UIUndoManager pointer advances even when we preventDefault).
    if (event.inputType === "historyUndo") {
      event.preventDefault();
      runInputCommand(undoCommand);
      rePrimeUndoStack();
      return;
    }

    if (event.inputType === "historyRedo") {
      event.preventDefault();
      runInputCommand(redoCommand);
      rePrimeUndoStack();
      return;
    }
  });

  // Fallback path for input that didn't go through `handleBeforeInput`
  // (some IMEs, some browser quirks). We see the textarea's post-mutation
  // value and reconcile it with the editor.
  const handleInput = useEffectEvent((event: FormEvent<HTMLTextAreaElement>) => {
    const state = readCurrentState();
    const value = event.currentTarget.value;
    const prefix = resolveInputPrefix(state);

    if (process.env.NODE_ENV !== "production") {
      const native = event.nativeEvent as InputEvent;
      emitDiagnostic("input", {
        inputType: native?.inputType ?? null,
        data: native?.data ?? null,
        isComposing: native?.isComposing ?? null,
        taValue: value,
        taValueLength: value.length,
        selectionStart: event.currentTarget.selectionStart,
        selectionEnd: event.currentTarget.selectionEnd,
        resolvedPrefix: prefix,
        stripped: stripSyncedInputPrefix(value, prefix),
        prefixMatched: stripInputSeed(value).startsWith(prefix),
      });
    }

    if (primingRef.current) return;

    // Textarea got cleared past INPUT_SEED (e.g. backspace on an empty
    // region). Re-seed it so further backspaces still fire `beforeinput`
    // — browsers won't emit the event when the textarea is truly empty.
    if (stripSyncedInputPrefix(value, prefix).length === 0) {
      syncInputContext(event.currentTarget, state);
      return;
    }

    runInputCommand(insertNativeText, value);
  });

  // Cross-handler contract: when this handler returns a state change for a
  // chord that the browser would otherwise also surface through a
  // `beforeinput` (notably Shift+Enter, which fires `keydown` with
  // `shiftKey: true` *and* `beforeinput` with `inputType: "insertLineBreak"`),
  // we MUST `preventDefault` here so the corresponding beforeinput is
  // suppressed. Otherwise the soft-break-via-keydown would be followed
  // immediately by a structural-Enter-via-beforeinput and the document
  // would mutate twice for one user gesture. This contract is also why
  // the beforeinput handler can safely route both `insertLineBreak` and
  // `insertParagraph` to structural Enter — the soft-break gesture is
  // already consumed before beforeinput fires.
  const handleKeyDown = useEffectEvent(
    (event: ReactKeyboardEvent<HTMLCanvasElement | HTMLTextAreaElement>) => {
      if (onKeyDown?.(event)) {
        return;
      }

      const transition = runInputCommand(
        applyKeyboardInput,
        store.layout.get(),
        event.nativeEvent,
        keybindings,
      );

      if (!transition) {
        return;
      }

      event.preventDefault();
    },
  );

  /* Clipboard handlers */

  // The editor speaks `Fragment`; the clipboard speaks markdown text. This
  // hook is the only place where the two cross paths — `parseFragment` /
  // `serializeFragment` adapt one to the other so the editor stays
  // format-agnostic.

  const handleCopy = useEffectEvent(
    (event: ClipboardEvent<HTMLCanvasElement | HTMLTextAreaElement>) => {
      const fragment = copySelection(readCurrentState());

      if (!fragment) {
        return;
      }

      event.preventDefault();
      event.clipboardData.setData("text/plain", serializeFragment(fragment));
    },
  );

  const handleCut = useEffectEvent(
    (event: ClipboardEvent<HTMLCanvasElement | HTMLTextAreaElement>) => {
      const state = readCurrentState();
      const fragment = copySelection(state);

      if (!fragment) {
        return;
      }

      event.preventDefault();
      event.clipboardData.setData("text/plain", serializeFragment(fragment));
      runInputCommand(deleteSelectionCommand);
    },
  );

  const handlePaste = useEffectEvent(
    async (event: ClipboardEvent<HTMLCanvasElement | HTMLTextAreaElement>) => {
      // Image items must be extracted synchronously: `clipboardData` is
      // invalidated as soon as the handler yields. Prefer image over text
      // when both are present (browsers commonly include both).
      const imageItem = onImagePaste
        ? [...event.clipboardData.items].find(
            (item) => item.kind === "file" && item.type.startsWith("image/"),
          )
        : undefined;
      const imageFile = imageItem?.getAsFile() ?? null;

      if (imageFile && onImagePaste) {
        event.preventDefault();
        const path = await onImagePaste(imageFile);
        if (path) {
          runInputCommand(insertImageCommand, path);
        }
        return;
      }

      const pastedText = event.clipboardData.getData("text/plain");

      if (pastedText.length === 0) {
        return;
      }

      if (/^https?:\/\//.test(pastedText)) {
        const transition = runInputCommand(insertLinkCommand, pastedText);
        if (transition) {
          event.preventDefault();
          return;
        }
      }

      event.preventDefault();
      const fragment = parseFragment(pastedText);
      runInputCommand(pasteFragmentCommand, fragment, pastedText);
    },
  );

  /* Focus handlers */

  const handleInputFocus = useEffectEvent(() => {
    onActivity();
    const input = inputRef.current;

    if (input) {
      syncInputContext(input, readCurrentState());
    }
  });

  // Bridges Tab-key focus on the canvas to the hidden textarea so keyboard
  // navigation reaches the editor's text input. Pointer-driven focus (mouse
  // click, touch tap) is intentionally NOT bridged here — click handlers in
  // `usePointer` call `focus()` explicitly when a tap should open the
  // keyboard (e.g. caret placement). Without the `:focus-visible` guard,
  // every tap on the canvas (including on a task-toggle checkbox) would
  // silently route focus to the textarea and open the iOS keyboard before
  // our click handler could decide whether the keyboard was wanted.
  const handleCanvasFocus = useEffectEvent((event: FocusEvent<HTMLCanvasElement>) => {
    onActivity();
    if (event.target.matches(":focus-visible")) {
      focus();
    }
  });

  /* Effects */

  // Mirror the editor state into the hidden textarea after every editor
  // state change so the OS sees up-to-date context (preceding chars,
  // caret position) for autocorrect, IME, and dictation. TODO: scope
  // this to region transitions only (or otherwise let the OS keep the
  // textarea as its own scratch space for the duration of an input
  // session) — see thread on dictation flush behavior.
  useEffect(() => {
    const input = inputRef.current;

    if (process.env.NODE_ENV !== "production") {
      emitDiagnostic("editorStateEffect", {
        regionId: editorState.selection.focus.regionId,
        caretOffset: editorState.selection.focus.offset,
        hasInput: !!input,
      });
    }

    if (!input) return;
    syncInputContext(input, editorState);
  }, [editorState, inputRef]);

  // Keep the hidden textarea positioned at the visible caret's pixel
  // coordinates so that mobile browsers' "scroll focused input into view
  // when the virtual keyboard appears" heuristic targets the right spot.
  // See `positionInputAtPoint` for details. Uses a layout effect so
  // positioning lands before the browser paints.
  useLayoutEffect(() => {
    positionInputAtPoint(editorState.selection.focus);
  }, [editorState]);

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
  }, [inputRef]);

  // Install diagnostic listeners (composition events on the input bridge,
  // document `selectionchange`). Production strips this call and the
  // hook's body entirely (the `useEffect` registrations included). The
  // conditional-hooks lint rule is disabled because the gate is a
  // build-time constant — within a single bundle's lifetime the hook is
  // either always called or never called, preserving React's per-render
  // hook-ordering invariant.
  if (process.env.NODE_ENV !== "production") {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useDiagnostics(inputRef);
  }

  /* Public API */

  const sharedHandlers: SharedInputHandlers = {
    onCopy: handleCopy,
    onCut: handleCut,
    onPaste: handlePaste,
    ...(!isTouchPrimary || enableTouchKeyDown ? { onKeyDown: handleKeyDown } : {}),
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
    if (typeof window.matchMedia !== "function") {
      return false;
    }
    return window.matchMedia("(pointer: coarse)").matches;
  });

  useEffect(() => {
    if (typeof window.matchMedia !== "function") {
      return;
    }
    const mediaQuery = window.matchMedia("(pointer: coarse)");
    const onChange = (event: MediaQueryListEvent) => setIsTouchPrimary(event.matches);
    mediaQuery.addEventListener?.("change", onChange);
    return () => mediaQuery.removeEventListener?.("change", onChange);
  }, []);

  return isTouchPrimary;
}

// `insertParagraph` is what desktop browsers fire for plain Enter;
// `insertLineBreak` is what they fire for Shift+Enter — but iOS Safari
// fires `insertLineBreak` for the virtual keyboard's Return key
// regardless of any modifier state. Both inputTypes route to the same
// "structural Enter" command at this layer; soft breaks are reachable
// only via the Shift+Enter keybinding on physical keyboards (handled by
// `keydown`, which preventDefaults this beforeinput before it fires).
export function isLineBreakInputType(inputType: string) {
  return inputType === "insertLineBreak" || inputType === "insertParagraph";
}

// Reads the textarea's selection range — how many chars before the caret
// a `beforeinput` event is asking us to replace, plus how far the
// selection's trailing edge sits *before* the textarea's caret. iOS uses
// this channel to signal the replacement range for both
// `insertReplacementText` (OS autocorrect) and `insertText` (user-
// initiated replacements like the suggestion-bar tap or a voice
// dictation revision). macOS Text Replacements may also fire after the
// trigger character (e.g. the space) has already been inserted, so the
// selection's trailing edge can be earlier than the textarea's caret
// (and the editor caret); the trailing offset captures that gap so the
// editor-side replacement targets the right range. See the JSDoc on
// `handleBeforeInput` for the full taxonomy.
function resolveReplacementRange(target: EventTarget | null) {
  const textarea = target as HTMLTextAreaElement | null;
  const selStart = textarea?.selectionStart ?? 0;
  const selEnd = textarea?.selectionEnd ?? selStart;
  const valueLength = textarea?.value.length ?? selEnd;
  return {
    charsToReplace: Math.max(0, selEnd - selStart),
    trailingOffset: Math.max(0, valueLength - selEnd),
  };
}

// Detects iOS voice-dictation FLUSH events: a collapsed-selection
// `insertText` whose `data` begins with content already committed to the
// editor (delivered earlier via the non-collapsed-selection channel).
// iOS dumps the full transcript at session end (or when the partial
// outgrows the textarea bridge), without remembering what was already
// streamed. Returns the length of the leading overlap to skip, or 0 if
// no significant overlap is found. The threshold guards against false
// positives on plain typing and short IME commits.
function detectDictationFlushOverlap(state: EditorState, data: string) {
  if (data.length < DICTATION_FLUSH_OVERLAP_THRESHOLD) {
    return 0;
  }
  const editorTail = resolveInputPrefix(state, data.length);
  const maxPossibleOverlap = Math.min(editorTail.length, data.length);
  // Walk down from the largest possible overlap; first match wins. O(n²)
  // worst case, but n is bounded by the dictation partial length and the
  // loop terminates as soon as a match is found — which for real flushes
  // is on the very first iteration (overlap == prior partial length).
  for (let len = maxPossibleOverlap; len >= DICTATION_FLUSH_OVERLAP_THRESHOLD; len--) {
    if (editorTail.endsWith(data.slice(0, len))) {
      return len;
    }
  }
  return 0;
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

export function resolveInputPrefix(state: EditorState, maxLength = INPUT_CONTEXT_WINDOW) {
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
export function syncInputContext(input: HTMLTextAreaElement, state: EditorState) {
  const prefix = resolveInputPrefix(state);
  const nextValue = prefix.length > 0 ? prefix : INPUT_SEED;

  input.value = nextValue;
  input.setSelectionRange(nextValue.length, nextValue.length);
  // Force the textarea's internal scroll all the way right so the caret sits
  // at the visible edge of the 2px box. iOS does this implicitly after
  // `setSelectionRange`, but macOS Safari does not — leaving the caret
  // hundreds of px to the left of the box's painted area, which causes the
  // OS-drawn autocorrect inline highlight strip to leak past the right edge
  // (visible "input" artifact) and pushes the autocorrect popover far right
  // of the visible cursor. Aligning the content edge with the box edge clips
  // the highlight to the 2px box and anchors the popover to the caret.
  input.scrollLeft = input.scrollWidth;

  if (process.env.NODE_ENV !== "production") {
    emitDiagnostic("syncInputContext", {
      prefix,
      prefixLength: prefix.length,
      taValueLength: nextValue.length,
      regionId: state.selection.focus.regionId,
      caretOffset: state.selection.focus.offset,
    });
  }
}

// Apply the textarea's full value to the editor by stripping the synced
// prefix (everything we've already mirrored in) and inserting whatever
// remains as new text — splitting on `\n` so embedded line breaks turn
// into editor line-break operations rather than literal characters.
function insertNativeTextCommand(state: EditorState, value: string) {
  const insertedText = stripSyncedInputPrefix(value, resolveInputPrefix(state));
  const segments = insertedText.replace(/\r\n/g, "\n").split(/(\n)/);
  let nextState = state;

  for (const segment of segments) {
    if (segment.length === 0) continue;
    const result = segment === "\n" ? insertLineBreak(nextState) : insertText(nextState, segment);
    if (!result) continue;
    nextState = result;
  }

  return nextState === state ? null : nextState;
}

// Replace a range of `charsToDelete` characters with `replacement`, in a
// single editor action — one undo entry, one animation tick — instead of
// N delete + M insert operations. The range ends `trailingOffset` chars
// before the editor caret; `trailingOffset === 0` is the common case
// (replacement abuts the caret), but macOS Text Replacements can extend
// the textarea selection backward over a word while leaving the caret
// past a just-typed trailing character (e.g. the space that triggered
// the replacement) — see `resolveReplacementRange`.
function replaceNativeTextCommand(
  state: EditorState,
  charsToDelete: number,
  trailingOffset: number,
  replacement: string,
) {
  const focusPoint = state.selection.focus;
  const end = Math.max(0, focusPoint.offset - trailingOffset);
  const start = Math.max(0, end - charsToDelete);
  return replaceTextRange(state, start, end, replacement);
}

function applyKeyboardInputCommand(
  state: EditorState,
  viewport: EditorLayoutState,
  event: KeyboardEvent,
  keybindings?: EditorInputKeybinding[],
): EditorState | null {
  if (event.key === "Delete") {
    return deleteForward(state);
  }

  const command = resolveEditorInputCommand(event, keybindings);

  if (command) {
    return keyboardCommandHandlers[command]({ event, state, viewport });
  }

  if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
    return moveCaretHorizontally(state, event.key === "ArrowLeft" ? -1 : 1, event.shiftKey);
  }

  if (event.key === "ArrowUp" || event.key === "ArrowDown") {
    return moveCaretVertically(state, viewport, event.key === "ArrowUp" ? -1 : 1, event.shiftKey);
  }

  if (event.key === "PageUp" || event.key === "PageDown") {
    return moveCaretByViewport(state, viewport, event.key === "PageUp" ? -1 : 1, event.shiftKey);
  }

  if (event.key.length === 1 && !event.altKey && !event.ctrlKey && !event.metaKey) {
    return insertText(state, event.key);
  }

  return null;
}
