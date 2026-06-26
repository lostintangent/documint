import type { CSSProperties } from "react";
import { Minus, Palette, Plus } from "lucide-react";
import { getThemeOption, themeOptions } from "../../lib/data";
import {
  PlaygroundPopover,
  popoverControlClassName,
  popoverHeaderClassName,
  popoverTitleClassName,
} from "./PlaygroundPopover";

// Reasonable bounds for the font-size stepper. The lower edge keeps body text
// legible at typical viewing distances; the upper edge keeps heading scale
// (H1 = 2× base) from overflowing fixed leaf chrome at common widths.
const MIN_FONT_SIZE = 11;
const MAX_FONT_SIZE = 22;

type ThemePopoverProps = {
  customEffectsEnabled: boolean;
  fontSize: number;
  onCustomEffectsEnabledChange: (enabled: boolean) => void;
  onFontSizeChange: (fontSize: number) => void;
  onOpenChange?: (open: boolean) => void;
  onReadOnlyChange: (readOnly: boolean) => void;
  onShowDiffsChange: (showDiffs: boolean) => void;
  onThemeIdChange: (themeId: string) => void;
  open?: boolean;
  readOnly: boolean;
  showDiffs: boolean;
  themeId: string;
};

export function ThemePopover({
  customEffectsEnabled,
  fontSize,
  onCustomEffectsEnabledChange,
  onFontSizeChange,
  onOpenChange,
  onReadOnlyChange,
  onShowDiffsChange,
  onThemeIdChange,
  open,
  readOnly,
  showDiffs,
  themeId,
}: ThemePopoverProps) {
  const activeThemeOption = getThemeOption(themeId);
  const showSwatch = activeThemeOption.id !== "system";

  const decrement = () => {
    if (fontSize > MIN_FONT_SIZE) onFontSizeChange(fontSize - 1);
  };
  const increment = () => {
    if (fontSize < MAX_FONT_SIZE) onFontSizeChange(fontSize + 1);
  };

  return (
    <PlaygroundPopover
      ariaLabel="Select editor theme"
      icon={<Palette size={16} strokeWidth={2.1} />}
      iconStyle={showSwatch ? getThemeSwatchStyle(activeThemeOption) : undefined}
      onOpenChange={onOpenChange}
      open={open}
      size="sm"
      showSwatch={showSwatch}
    >
      {({ close }) => (
        <div className="grid gap-3">
          <div className={popoverHeaderClassName}>
            <strong className={popoverTitleClassName}>Theme</strong>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2">
                <input
                  checked={customEffectsEnabled}
                  onChange={(event) => onCustomEffectsEnabledChange(event.target.checked)}
                  type="checkbox"
                />
                <span>Effects</span>
              </label>
            </div>
          </div>

          <div className="grid gap-1.5">
            {themeOptions.map((option) => (
              <button
                className={`font-controls inline-flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-left ${
                  option.id === themeId
                    ? "border-accent/40 bg-accent/10"
                    : "border-border/15 bg-background/90"
                }`}
                key={option.id}
                onClick={() => {
                  onThemeIdChange(option.id);
                  close();
                }}
                style={getThemeOptionLabelStyle(option)}
                type="button"
              >
                <span
                  aria-hidden="true"
                  className="inline-flex size-6 flex-none items-center justify-center rounded-full border border-border/15"
                  style={getThemeSwatchStyle(option)}
                >
                  <Palette size={16} strokeWidth={2.1} />
                </span>
                {option.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2 border-t border-border/10 pt-3">
            <button
              aria-label="Decrease font size"
              className={`${popoverControlClassName} inline-flex size-7 items-center justify-center rounded-full disabled:cursor-not-allowed disabled:opacity-40`}
              disabled={fontSize <= MIN_FONT_SIZE}
              onClick={decrement}
              type="button"
            >
              <Minus size={14} strokeWidth={2.4} />
            </button>
            <span className="font-controls flex-1 text-center text-base tabular-nums">
              {fontSize}px
            </span>
            <button
              aria-label="Increase font size"
              className={`${popoverControlClassName} inline-flex size-7 items-center justify-center rounded-full disabled:cursor-not-allowed disabled:opacity-40`}
              disabled={fontSize >= MAX_FONT_SIZE}
              onClick={increment}
              type="button"
            >
              <Plus size={14} strokeWidth={2.4} />
            </button>
          </div>

          <label className="flex items-center justify-between gap-3 border-t border-border/10 pt-3">
            <span>Read-only?</span>
            <input
              checked={readOnly}
              onChange={(event) => onReadOnlyChange(event.target.checked)}
              type="checkbox"
            />
          </label>

          <label className="flex items-center justify-between gap-3">
            <span>Show diffs?</span>
            <input
              checked={showDiffs}
              onChange={(event) => onShowDiffsChange(event.target.checked)}
              type="checkbox"
            />
          </label>
        </div>
      )}
    </PlaygroundPopover>
  );
}

function getThemeOptionLabelStyle(option: (typeof themeOptions)[number]): CSSProperties {
  return {
    color:
      option.id === "dark"
        ? "#111827"
        : option.id === "midnight"
          ? "#6d28d9"
          : (option.theme?.paragraphText ??
            option.theme?.leafText ??
            option.theme?.text ??
            "#1f2937"),
  };
}

function getThemeSwatchStyle(option: (typeof themeOptions)[number]): CSSProperties {
  return {
    background:
      option.theme?.background ??
      "linear-gradient(135deg, rgba(15, 23, 42, 0.16), rgba(148, 163, 184, 0.32))",
    borderColor: option.theme?.tableBorder ?? "rgba(15, 23, 42, 0.16)",
    color: option.theme?.caret ?? "rgba(15, 23, 42, 0.68)",
  };
}
