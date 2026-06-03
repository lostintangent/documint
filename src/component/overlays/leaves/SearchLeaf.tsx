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

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus({ preventScroll: true });
    input.select();
  }, []);

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.select();
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onDismiss();
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      if (!canNavigate) {
        return;
      }
      if (event.shiftKey) {
        onPrevious();
      } else {
        onNext();
      }
    }
  };

  return (
    <div className="documint-search-leaf">
      <div className="documint-search-input-shell">
        <Search aria-hidden="true" size={15} strokeWidth={2.2} />
        <input
          aria-label="Search document"
          className="documint-search-input"
          onChange={(event) => onChange(event.currentTarget.value)}
          onKeyDown={handleKeyDown}
          ref={inputRef}
          spellCheck={false}
          value={query}
        />
        <span className="documint-search-input-actions">
          {resultCount ? <span className="documint-search-count">{resultCount}</span> : null}
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
  if (query.length === 0) {
    return null;
  }

  return `${activeMatchNumber} / ${matchCount}`;
}

function SearchButton({ className, ...props }: Omit<LeafButtonProps, "iconSize">) {
  return (
    <LeafButton
      {...props}
      className={clx("w-[1.45rem] min-w-[1.45rem] !p-0", className)}
      iconSize={15}
    />
  );
}

function preserveFocus(event: PointerEvent<HTMLButtonElement>) {
  event.preventDefault();
}
