import { useEffect, useRef, type PointerEvent } from "react";
import type { CompletionItem } from "../../completions/completions";

type CompletionLeafProps = {
  activeIndex: number;
  matches: readonly CompletionItem[];
  onHover: (index: number) => void;
  onSelect: (item: CompletionItem) => void;
};

const completionItemBaseClass = "documint-leaf-menu-item documint-completion-item";

export function CompletionLeaf({ activeIndex, matches, onHover, onSelect }: CompletionLeafProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Keep the active item in view when navigating with the keyboard.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const child = container.children[activeIndex];
    if (child instanceof HTMLElement) {
      child.scrollIntoView({ block: "nearest" });
    }
  }, [activeIndex]);

  return (
    <div className="documint-completion-leaf" ref={containerRef} role="listbox">
      {matches.map((item, index) => {
        const isActive = index === activeIndex;
        return (
          <button
            aria-selected={isActive}
            className={`${completionItemBaseClass}${isActive ? " is-active" : ""}`}
            key={completionItemKey(item)}
            onPointerDown={preserveInputFocus}
            onPointerEnter={() => onHover(index)}
            onClick={() => onSelect(item)}
            role="option"
            type="button"
          >
            {item.icon ? (
              <span aria-hidden="true" className="documint-completion-item-icon">
                {item.icon}
              </span>
            ) : null}
            <span>{item.label}</span>
          </button>
        );
      })}
    </div>
  );
}

// Prevent the textarea/canvas from losing focus when the user clicks a row.
function preserveInputFocus(event: PointerEvent<HTMLButtonElement>) {
  event.preventDefault();
}

function completionItemKey(item: CompletionItem) {
  return item.id ?? `${item.kind ?? ""}:${item.label}:${item.insertText ?? ""}:${item.icon ?? ""}`;
}
