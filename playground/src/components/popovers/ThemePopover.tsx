import type { CSSProperties } from "react";
import { Palette } from "lucide-react";
import { getThemeOption, themeOptions } from "../../lib/data";
import { PlaygroundPopover } from "./PlaygroundPopover";

type ThemePopoverProps = {
  onThemeIdChange: (themeId: string) => void;
  themeId: string;
};

export function ThemePopover({ onThemeIdChange, themeId }: ThemePopoverProps) {
  const activeThemeOption = getThemeOption(themeId);
  const showSwatch = activeThemeOption.id !== "system";

  return (
    <PlaygroundPopover
      ariaLabel="Select editor theme"
      icon={<Palette size={16} strokeWidth={2.1} />}
      iconStyle={showSwatch ? getThemeSwatchStyle(activeThemeOption) : undefined}
      size="sm"
      showSwatch={showSwatch}
    >
      {({ close }) => (
        <div className="grid gap-[0.35rem]">
          {themeOptions.map((option) => (
            <button
              className={`font-controls inline-flex cursor-pointer items-center gap-[0.55rem] rounded-xl border px-3 py-[0.55rem] text-left ${
                option.id === themeId
                  ? "border-accent/40 bg-accent/[0.08]"
                  : "border-border/[0.12] bg-background/[0.9]"
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
                className="inline-flex h-[1.4rem] w-[1.4rem] flex-none items-center justify-center rounded-full border border-border/[0.14]"
                style={getThemeSwatchStyle(option)}
              >
                <Palette size={16} strokeWidth={2.1} />
              </span>
              {option.label}
            </button>
          ))}
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
          : (option.theme?.paragraphText ?? option.theme?.leafText ?? option.theme?.text ?? "#1f2937"),
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
