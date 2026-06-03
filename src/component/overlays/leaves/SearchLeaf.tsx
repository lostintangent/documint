// Floating search bar — the only fixed-position leaf (rendered as editor
// chrome by `OverlayLeaf`, not as a document-anchored popover). Wraps a
// text input with a leading magnifier and trailing case-toggle, plus
// prev/next/close buttons. Driven entirely by host state via props; the
// leaf itself owns no search logic, just the keyboard contract.

import { ChevronDown, ChevronUp, Search, X } from "lucide-react";
import { useEffect, useRef, type KeyboardEvent, type PointerEvent } from "react";
import { LeafButton, type LeafButtonProps } from "./core/LeafButton";
import { LeafDivider } from "./core/LeafDivider";
import { clx } from "./core/lib/clx";

type SearchLeafProps = {
  activeMatchNumber: number;
  canNavigate: boolean;
  caseSensitive: boolean;
  matchCount: number;
  onChange: (query: string) => void;
  onClose: () => void;
  onDismiss: () => void;
  onNext: () => void;
  onPrevious: () => void;
  onToggleCaseSensitive: () => void;
  query: string;
};

export function SearchLeaf({
  activeMatchNumber,
  canNavigate,
  caseSensitive,
  matchCount,
  onChange,
  onClose,
  onDismiss,
  onNext,
  onPrevious,
  onToggleCaseSensitive,
  query,
}: SearchLeafProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const resultCount = resolveSearchResultCount(query, activeMatchNumber, matchCount);

  // Focus + select on mount so the user can immediately type a new query
  // or overwrite the previous one without an extra click.
  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus({ preventScroll: true });
    input.select();
  }, []);

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    // Cmd/Ctrl+F retargets the host's find shortcut at the search input
    // instead — selects the existing query for quick replacement.
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
      suppressEvent(event);
      event.currentTarget.select();
      return;
    }

    if (event.key === "Escape") {
      suppressEvent(event);
      onDismiss();
      return;
    }

    if (event.key === "Enter") {
      suppressEvent(event);
      if (!canNavigate) return;
      if (event.shiftKey) {
        onPrevious();
      } else {
        onNext();
      }
    }
  };

  return (
    // `documint-search-leaf` is retained as a marker class only — the shell's
    // `:has(> .documint-search-leaf)` rule in styles.css uses it to set the
    // toolbar-tight padding around this leaf. Styling otherwise is Tailwind.
    <div className="documint-search-leaf grid grid-cols-[minmax(12.5rem,18rem)_repeat(2,1.45rem)_0.5rem_1.45rem] items-center gap-1">
      <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-1.5 min-w-0 py-1 px-2 border border-leaf-border rounded-[0.62rem] bg-leaf-input-bg text-leaf-secondary">
        <Search aria-hidden="true" size={15} strokeWidth={2.2} />
        <input
          aria-label="Search document"
          className="w-full min-w-0 border-0 outline-0 bg-transparent text-leaf-text [font:inherit]"
          onChange={(event) => onChange(event.currentTarget.value)}
          onKeyDown={handleKeyDown}
          ref={inputRef}
          spellCheck={false}
          value={query}
        />
        <span className="inline-flex items-center gap-1">
          {resultCount && (
            <span className="min-w-11 text-leaf-secondary text-xs text-right whitespace-nowrap">
              {resultCount}
            </span>
          )}
          <SearchButton
            aria-pressed={caseSensitive}
            active={caseSensitive}
            className="text-xs font-semibold leading-none"
            hover="input"
            onClick={onToggleCaseSensitive}
            onPointerDown={preserveFocus}
            title="Match case"
          >
            Aa
          </SearchButton>
        </span>
      </div>
      <SearchButton
        disabled={!canNavigate}
        icon={ChevronUp}
        onClick={onPrevious}
        onPointerDown={preserveFocus}
        title="Previous match"
      />
      <SearchButton
        disabled={!canNavigate}
        icon={ChevronDown}
        onClick={onNext}
        onPointerDown={preserveFocus}
        title="Next match"
      />
      <LeafDivider orientation="vertical" />
      <SearchButton icon={X} onClick={onClose} onPointerDown={preserveFocus} title="Close search" />
    </div>
  );
}

// `0 / 0` doubles as the "no results" affordance once the query is non-empty.
function resolveSearchResultCount(
  query: string,
  activeMatchNumber: number,
  matchCount: number,
): string | null {
  if (query.length === 0) return null;
  return `${activeMatchNumber} / ${matchCount}`;
}

// Search-bar icon button. `min-w-5.8` is inherited from `LeafButton`'s
// icon-only branch and the outer grid stretches the button to fill its
// 1.45rem column, so no width utilities are needed here. `!p-0` overrides
// `LeafButton`'s `px-0.5` to keep the icon hard-centered within the cell.
function SearchButton({ className, ...props }: Omit<LeafButtonProps, "iconSize">) {
  return <LeafButton {...props} className={clx("!p-0", className)} iconSize={15} />;
}

// Prevent the input from losing focus when the user taps a search button.
function preserveFocus(event: PointerEvent<HTMLButtonElement>) {
  event.preventDefault();
}

function suppressEvent(event: KeyboardEvent<HTMLInputElement>) {
  event.preventDefault();
  event.stopPropagation();
}
