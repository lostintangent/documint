import type { EditorCommand } from "@/editor/model/commands";

export type EditorKeybinding = {
  altKey?: boolean;
  command: EditorCommand;
  key: string;
  modKey?: boolean;
  shiftKey?: boolean | "any";
};

export const defaultKeybindings: EditorKeybinding[] = [
  { key: "Backspace", command: "deleteBackward" },
  { key: "Enter", command: "insertLineBreak" },
  { key: "Home", command: "moveToLineStart" },
  { key: "End", command: "moveToLineEnd" },
  { key: "Tab", command: "indent" },
  { key: "Tab", shiftKey: true, command: "dedent" },
  { key: "ArrowLeft", modKey: true, shiftKey: "any", command: "moveToLineStart" },
  { key: "ArrowRight", modKey: true, shiftKey: "any", command: "moveToLineEnd" },
  { key: "ArrowUp", altKey: true, shiftKey: true, command: "moveListItemUp" },
  { key: "ArrowDown", altKey: true, shiftKey: true, command: "moveListItemDown" },
  { key: "b", modKey: true, command: "toggleSelectionBold" },
  { key: "e", modKey: true, command: "toggleSelectionInlineCode" },
  { key: "i", modKey: true, command: "toggleSelectionItalic" },
  { key: "u", modKey: true, command: "toggleSelectionUnderline" },
  { key: "y", modKey: true, command: "redo" },
  { key: "z", modKey: true, command: "undo" },
  { key: "z", modKey: true, shiftKey: true, command: "redo" },
];

export function resolveEditorCommand(
  event: KeyboardEvent,
  keybindings: EditorKeybinding[] = defaultKeybindings,
): EditorCommand | null {
  return keybindings.find((binding) => {
    const shiftMatches =
      binding.shiftKey === "any"
        ? true
        : (binding.shiftKey ?? false) === (event.shiftKey ?? false);

    return (
      binding.key.toLowerCase() === event.key.toLowerCase() &&
      (binding.altKey ?? false) === (event.altKey ?? false) &&
      shiftMatches &&
      (binding.modKey ?? false) === Boolean(event.metaKey || event.ctrlKey)
    );
  })?.command ?? null;
}
