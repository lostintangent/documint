// Individual presence indicator — avatar, optional status text (revealed
// on hover or keyboard focus), and an arrow when the user's viewport
// position is above/below the editor's visible area. Clicking scrolls
// them into view.
//
// Used by `ViewportAnchor`, which positions a column of these indicators
// alongside the search leaf in the editor's top-right chrome.
//
// Static styling lives in TSX as Tailwind utilities; the animated reveal
// of the status text and the divider next to it lives as
// `@layer components` classes (`.presence-status`, `.presence-divider`)
// in `tailwind.css` since the dual hover-OR-focus-visible trigger doesn't
// compose cleanly as a single utility variant.

import { ArrowDown, ArrowUp } from "lucide-react";
import type { CSSProperties } from "react";
import type { EditorPresence } from "@/editor";
import { resolvePresenceName } from "../lib/presence";
import { clx } from "./leaves/core/lib/clx";
import { LeafDivider } from "./leaves/core/LeafDivider";

type PresenceIndicatorProps = {
  onSelect: () => void;
  presence: EditorPresence;
};

export function PresenceIndicator({ onSelect, presence }: PresenceIndicatorProps) {
  const viewport = presence.viewport;
  const initial = resolvePresenceInitial(presence);
  const status = resolvePresenceStatus(presence);
  const DirectionIcon = viewport?.status === "above" ? ArrowUp : ArrowDown;
  const canScrollToPresence = viewport !== null && viewport.status !== "unresolved";
  const showDirection = viewport?.status === "above" || viewport?.status === "below";

  return (
    <div
      className="presence-row relative inline-flex items-start gap-1.5 pointer-events-auto"
      style={
        {
          "--documint-presence-color": presence.color ?? "var(--documint-leaf-accent)",
        } as CSSProperties
      }
    >
      <button
        aria-label={resolvePresenceAriaLabel(presence)}
        className={clx(
          "presence-button",
          "inline-flex flex-row-reverse items-center min-w-5.8 h-5.8 p-0",
          "border border-leaf-border rounded-full bg-leaf-bg",
          "[box-shadow:var(--documint-leaf-shadow,var(--documint-leaf-shadow-fallback))]",
          "text-leaf-text font-leaf text-[0.66rem] font-semibold leading-none",
          "cursor-pointer pointer-events-auto disabled:cursor-default disabled:opacity-70",
        )}
        data-status={viewport?.status ?? "unresolved"}
        disabled={!canScrollToPresence}
        onClick={canScrollToPresence ? onSelect : undefined}
        type="button"
      >
        <span className="inline-grid place-items-center w-5.8 h-5.8 p-px overflow-hidden rounded-full bg-[var(--documint-presence-color)] text-white">
          {presence.avatarUrl ? (
            <img
              alt=""
              aria-hidden="true"
              className="block w-full h-full rounded-[inherit] object-cover"
              draggable={false}
              src={presence.avatarUrl}
            />
          ) : (
            initial
          )}
        </span>
        {status && (
          // `max-width` and `padding` come from `.presence-status` in
          // `tailwind.css` (animates in/out on hover/focus); deliberately no
          // `max-w-*` or `p-*` utilities here — those would land in
          // `@layer utilities` and outrank the component class, blocking the
          // reveal.
          <span className="presence-status inline-flex items-center h-full overflow-hidden overflow-x-auto text-leaf-secondary text-[0.72rem] font-normal leading-none whitespace-nowrap [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {status}
          </span>
        )}
        {status && showDirection && (
          // `!h-[0.78rem]` overrides `LeafDivider`'s default `h-5`; the
          // `presence-divider` class (in `tailwind.css`) handles the opacity
          // reveal that runs alongside the status text's slide-out.
          <LeafDivider
            className="presence-divider self-center !h-[0.78rem]"
            orientation="vertical"
          />
        )}
        {showDirection && (
          <span className="inline-flex items-center h-full pl-[0.36rem] pr-[0.42rem] text-leaf-text">
            <DirectionIcon size={14} strokeWidth={2.3} />
          </span>
        )}
      </button>
    </div>
  );
}

function resolvePresenceInitial(presence: EditorPresence) {
  return resolvePresenceName(presence).charAt(0).toLocaleUpperCase();
}

function resolvePresenceAriaLabel(presence: EditorPresence) {
  const name = resolvePresenceName(presence);
  const status = presence.viewport?.status ?? "unresolved";

  if (status === "above") return `${name} above viewport`;
  if (status === "below") return `${name} below viewport`;
  if (status === "unresolved") return `${name} unresolved`;

  return `${name} in viewport`;
}

function resolvePresenceStatus(presence: EditorPresence) {
  const status = presence.status?.trim();
  return status ? status : null;
}
