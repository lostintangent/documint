import { Keyboard } from "lucide-react";
import { resolveEditorHostPlatform } from "@/component/lib/platform";
import { PlaygroundPopover, popoverTitleClassName } from "./PlaygroundPopover";

type Shortcut = {
  label: string;
  macKeys: string;
  nonMacKeys: string;
};

const keyColumn = resolveEditorHostPlatform() === "mac" ? "macKeys" : "nonMacKeys";

const shortcuts: readonly Shortcut[] = [
  { label: "Move by word", macKeys: "⌥ ← / →", nonMacKeys: "Ctrl ← / →" },
  {
    label: "Select by word",
    macKeys: "⌥ ⇧ ← / →",
    nonMacKeys: "Ctrl Shift ← / →",
  },
  {
    label: "Delete previous / next word",
    macKeys: "⌥ ⌫ / ⌥ ⌦",
    nonMacKeys: "Ctrl ⌫ / Ctrl Delete",
  },
  {
    label: "Move to line start / end",
    macKeys: "⌘ ← / →",
    nonMacKeys: "Home / End",
  },
  {
    label: "Move to document start / end",
    macKeys: "⌘ ↑ / ↓",
    nonMacKeys: "Ctrl Home / Ctrl End",
  },
  { label: "Select all", macKeys: "⌘ A", nonMacKeys: "Ctrl A" },
  { label: "Undo / redo", macKeys: "⌘ Z / ⇧ ⌘ Z", nonMacKeys: "Ctrl Z / Ctrl Y" },
  {
    label: "Toggle strikethrough",
    macKeys: "⇧ ⌘ X",
    nonMacKeys: "Ctrl Shift X",
  },
];

export function KeybindingsPopover() {
  return (
    <PlaygroundPopover
      ariaLabel="Editing keybindings"
      icon={<Keyboard size={16} strokeWidth={2.1} />}
      size="md"
      showSwatch={false}
    >
      <strong className={popoverTitleClassName}>Editing keybindings</strong>

      <div className="grid max-h-[min(65vh,30rem)] gap-2 overflow-y-auto">
        {shortcuts.map((shortcut) => (
          <div
            className="grid grid-cols-[minmax(8rem,auto)_1fr] items-center gap-3 rounded-xl border border-border/10 bg-background/90 px-3 py-2"
            key={shortcut.label}
          >
            <kbd className="font-code text-xs font-semibold whitespace-nowrap text-foreground">
              {shortcut[keyColumn]}
            </kbd>
            <span className="text-sm text-muted">{shortcut.label}</span>
          </div>
        ))}
      </div>
    </PlaygroundPopover>
  );
}
