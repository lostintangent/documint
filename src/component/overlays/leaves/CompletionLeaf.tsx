// Inline completion popover — vertical list of matches that the user
// navigates with arrow keys and selects with Enter/click. Anchors to the
// caret position via `DocumentAnchor` (from `LeafInput` or
// `useDocumentCompletions`). Each row is a labeled `LeafButton`, so
// appearance and hover/active states stay consistent with toolbar menus.

import { useEffect, useRef, type PointerEvent } from "react";
import type { CompletionItem } from "../../completions/completions";
import { LeafButton } from "./core/LeafButton";

type CompletionLeafProps = {
  activeIndex: number;
  matches: readonly CompletionItem[];
  onHover: (index: number) => void;
  onSelect: (item: CompletionItem) => void;
};

export function CompletionLeaf({ activeIndex, matches, onHover, onSelect }: CompletionLeafProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Manual "scroll active row into view" for keyboard navigation.
  // `scrollIntoView()` would also scroll outer page ancestors horizontally
  // on mobile Safari, so we adjust `scrollTop` ourselves.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const child = container.children[activeIndex];
    if (!(child instanceof HTMLElement)) return;

    const childBounds = child.getBoundingClientRect();
    const containerBounds = container.getBoundingClientRect();

    if (childBounds.top < containerBounds.top) {
      container.scrollTop -= containerBounds.top - childBounds.top;
    } else if (childBounds.bottom > containerBounds.bottom) {
      container.scrollTop += childBounds.bottom - containerBounds.bottom;
    }
  }, [activeIndex]);

  return (
    <div
      // `max-h-33` (8.25rem) fits exactly 5 LeafButton-height (1.45rem)
      // rows with four `gap-1` (0.25rem) separators; overflow scrolls.
      className="p-1.5 grid gap-1 min-w-48 max-h-33 overflow-y-auto font-leaf text-sm"
      ref={containerRef}
      role="listbox"
    >
      {matches.map((item, index) => {
        const isActive = index === activeIndex;
        return (
          <LeafButton
            active={isActive}
            aria-selected={isActive}
            icon={renderCompletionIcon(item.icon)}
            key={completionItemKey(item)}
            label={item.label}
            onClick={() => onSelect(item)}
            onPointerDown={preserveInputFocus}
            onPointerEnter={() => onHover(index)}
            role="option"
          />
        );
      })}
    </div>
  );
}

function renderCompletionIcon(icon: CompletionItem["icon"]) {
  if (!icon) return undefined;

  return (
    <span aria-hidden="true" className="w-[1.25em] flex-none text-center">
      {icon}
    </span>
  );
}

// Prevent the textarea/canvas from losing focus when the user clicks a row.
function preserveInputFocus(event: PointerEvent<HTMLButtonElement>) {
  event.preventDefault();
}

function completionItemKey(item: CompletionItem) {
  return item.id ?? `${item.kind ?? ""}:${item.label}:${item.insertText ?? ""}:${item.icon ?? ""}`;
}
