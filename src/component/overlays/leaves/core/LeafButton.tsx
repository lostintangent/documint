// Compact icon button used throughout leaf chrome. Two render shapes share
// the same appearance and interaction behavior:
//
//   - icon-only:  centered square. Used when the icon alone communicates
//                 the action — the `title` prop drives both the tooltip
//                 and the accessible name.
//   - labeled:    full-width row with icon + text aligned to the start.
//                 Used inside vertical dropdown menus where each item
//                 shares the row width. The visible label is the
//                 accessible name; the tooltip is suppressed since it
//                 would just duplicate.

import type { LucideIcon } from "lucide-react";
import { isValidElement, type ButtonHTMLAttributes, type ReactNode } from "react";
import { clx } from "./lib/clx";

export type LeafButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "aria-label" | "title"
> & {
  active?: boolean;
  children?: ReactNode;
  danger?: boolean;
  // Picks the hover/active palette. `default` uses the leaf chrome accent;
  // `input` uses the slightly darker variant for buttons inside textarea chrome.
  hover?: "default" | "input";
  // A Lucide component (rendered with leaf-standard size + stroke) or any
  // ReactNode for non-Lucide icons (e.g. emoji in a styled span).
  icon?: LucideIcon | ReactNode;
  iconSize?: number;
  // Visible label. When set, the button takes the labeled (full-width row) shape.
  label?: string;
  // Tooltip + accessible name. Required for icon-only buttons; optional
  // when `label` is set (visible label already provides accessibility).
  title?: string;
};

export function LeafButton({
  active = false,
  children,
  className,
  danger = false,
  hover = "default",
  icon,
  iconSize = 14,
  label,
  title,
  type = "button",
  ...props
}: LeafButtonProps) {
  const isLabeled = label !== undefined;

  return (
    <button
      {...props}
      aria-label={title ?? label}
      className={clx(
        // `h-5.8` / `min-w-5.8` resolve via the custom `--spacing-5_8`
        // (1.45rem) — `h-6` (1.5rem) overshoots by 0.8px and feels chunky.
        "appearance-none inline-flex items-center h-5.8 border-0 cursor-pointer [font:inherit] transition-colors duration-100 ease-in-out disabled:opacity-40 disabled:cursor-default disabled:hover:bg-transparent",
        isLabeled
          ? "w-full justify-start gap-3 pl-1.5 pr-2.5 rounded-lg text-left"
          : "justify-center min-w-5.8 px-0.5 rounded-md",
        danger ? "text-leaf-accent" : "text-leaf-button",
        hover === "input"
          ? "hover:bg-leaf-input-button-active-bg"
          : "hover:bg-leaf-button-active-bg",
        active
          ? clx(
              hover === "input" ? "bg-leaf-input-button-active-bg" : "bg-leaf-button-active-bg",
              "text-leaf-text",
            )
          : "bg-transparent",
        className,
      )}
      title={isLabeled ? undefined : title}
      type={type}
    >
      {renderIcon(icon, iconSize, isLabeled)}
      {label !== undefined && <span className="whitespace-nowrap">{label}</span>}
      {children}
    </button>
  );
}

function renderIcon(
  icon: LeafButtonProps["icon"],
  iconSize: number,
  isLabeled: boolean,
): ReactNode {
  if (!icon) return null;

  // A LucideIcon is a `forwardRef` exotic component (object, not function),
  // so we discriminate via `isValidElement`: React elements pass through
  // as-is; component types get invoked with leaf-standard sizing.
  if (isValidElement(icon)) return icon;

  const Icon = icon as LucideIcon;
  return (
    <Icon
      // `flex-none -translate-y-px` only matters when a text sibling needs
      // baseline alignment; icon-only buttons center the icon via the parent.
      className={isLabeled ? "flex-none -translate-y-px" : undefined}
      size={iconSize}
      strokeWidth={2.2}
    />
  );
}
