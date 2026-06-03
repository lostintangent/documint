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
  hover?: "default" | "input";
  // A Lucide component (rendered with the leaf's standard size + stroke)
  // or any ReactNode for non-Lucide icons (e.g. emoji/character in a
  // styled span, as used by completion items).
  icon?: LucideIcon | ReactNode;
  iconSize?: number;
  label?: string;
  // Required for icon-only buttons (drives both the tooltip and the
  // accessible name). Optional when `label` is set, since the visible
  // label already provides the accessible name and a tooltip would
  // just duplicate it.
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
  // Two shapes share the same appearance/behavior:
  //   - icon-only:  compact centered square (toolbar buttons, action chips).
  //   - labeled:    full-width row with an icon and a text label aligned
  //                 to the start (dropdown menu items, where the surrounding
  //                 surface is a vertical list of equal-width rows).
  const labeled = label !== undefined;

  return (
    <button
      {...props}
      // Accessible name: prefer the explicit `title` when set (lets callers
      // give a more descriptive name than the visible label), otherwise
      // fall back to the visible `label`.
      aria-label={title ?? label}
      className={clx(
        "appearance-none inline-flex items-center h-[1.45rem] border-0 cursor-pointer [font:inherit] transition-colors duration-100 ease-in-out disabled:opacity-40 disabled:cursor-default disabled:hover:bg-transparent",
        // `h-[1.45rem]` and `min-w-[1.45rem]` use arbitrary values because
        // Tailwind's `h-6 / min-w-6` (1.5rem) overshoots this compact scale
        // by 0.8px, which reads as too chunky for the leaf chrome.
        labeled
          ? "w-full justify-start gap-3 pl-1.5 pr-2.5 rounded-lg text-left"
          : "justify-center min-w-[1.45rem] px-0.5 rounded-md",
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
      // Tooltip is only useful for icon-only buttons where the icon alone
      // doesn't communicate the action. When a visible label is rendered,
      // the tooltip would duplicate it and slow the interaction.
      title={labeled ? undefined : title}
      type={type}
    >
      {renderIcon(icon, iconSize, labeled)}
      {label !== undefined ? <span className="whitespace-nowrap">{label}</span> : null}
      {children}
    </button>
  );
}

function renderIcon(icon: LeafButtonProps["icon"], iconSize: number, labeled: boolean): ReactNode {
  if (!icon) {
    return null;
  }

  // A LucideIcon is a `forwardRef` exotic component — it's an object, not a
  // function, so `typeof icon === "function"` would miss it. Discriminate
  // instead via `isValidElement`: anything already a React element (custom
  // icon markup the caller built with JSX) renders as-is; anything else is
  // assumed to be a component type to invoke with leaf-standard sizing.
  if (isValidElement(icon)) {
    return icon;
  }

  const Icon = icon as LucideIcon;
  return (
    <Icon
      // `flex-none -translate-y-px` only matters when there's a text
      // sibling to align against; for icon-only buttons the parent's
      // `justify-center items-center` already centers it.
      className={labeled ? "flex-none -translate-y-px" : undefined}
      size={iconSize}
      strokeWidth={2.2}
    />
  );
}
