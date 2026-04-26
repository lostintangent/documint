// Shared input for leaf surfaces. Wraps a textarea with two pluggable concerns:
//   1. Action chrome — either edit (cancel + save) or compose (send).
//   2. Optional completion popovers triggered by single characters in the text.
// LinkLeaf uses this without completion sources; AnnotationLeaf wires presence
// users in as an "@"-mention source. The popover reuses the leaf-menu styles
// so completion lists and toolbar menus share a single visual identity.
//
// The popover is rendered through OverlayPortal so it escapes any overflow
// clipping or stacking-context interference from ancestors (the comment
// thread, the embedding host application, etc.). Layering above the leaf
// is handled by z-index in the popover's CSS.
import { Check, SendHorizontal, X, type LucideIcon } from "lucide-react";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type PointerEvent,
  type SyntheticEvent,
} from "react";
import { OverlayPortal } from "../../OverlayPortal";
import { resolveTextareaAnchor } from "../lib/textarea-anchor";

export type CompletionItem = {
  label: string;
};

export type CompletionSource = {
  trigger: string;
  items: CompletionItem[];
};

export type LeafInputActions =
  | {
      kind: "edit";
      onCancel: () => void;
      onSave: () => void;
      saveDisabled?: boolean;
    }
  | {
      kind: "compose";
      onSubmit: () => void;
      submitDisabled?: boolean;
      submitLabel: string;
    };

type LeafInputProps = {
  actions: LeafInputActions;
  completionSources?: CompletionSource[];
  onChange: (value: string) => void;
  placeholder?: string;
  readOnly?: boolean;
  rows?: number;
  value: string;
};

type ActiveCompletion = {
  trigger: string;
  query: string;
  triggerStart: number;
  caret: number;
  matches: CompletionItem[];
};

const popoverMaxHeight = 240;
const completionItemBaseClass = "documint-leaf-menu-item documint-completion-item";

export const LeafInput = forwardRef<HTMLTextAreaElement, LeafInputProps>(function LeafInput(
  { actions, completionSources, onChange, placeholder, readOnly = false, rows = 3, value },
  ref,
) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  useImperativeHandle(ref, () => textareaRef.current as HTMLTextAreaElement, []);

  const sortedSources = useMemo(() => sortSources(completionSources), [completionSources]);

  const [activeCompletion, setActiveCompletion] = useState<ActiveCompletion | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [popoverPosition, setPopoverPosition] = useState<{ left: number; top: number } | null>(
    null,
  );

  const updateActiveCompletion = useCallback(
    (nextValue: string, caret: number) => {
      if (!sortedSources.length) {
        setActiveCompletion(null);
        return;
      }

      const detected = detectCompletionContext(nextValue, caret, sortedSources);

      if (!detected) {
        setActiveCompletion(null);
        return;
      }

      setActiveCompletion(detected);
      setActiveIndex(0);
    },
    [sortedSources],
  );

  const handleChange = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => {
      const nextValue = event.currentTarget.value;
      const caret = event.currentTarget.selectionEnd ?? nextValue.length;

      onChange(nextValue);
      updateActiveCompletion(nextValue, caret);
    },
    [onChange, updateActiveCompletion],
  );

  const handleSelect = useCallback(
    (event: SyntheticEvent<HTMLTextAreaElement>) => {
      const textarea = event.currentTarget;
      updateActiveCompletion(textarea.value, textarea.selectionEnd ?? textarea.value.length);
    },
    [updateActiveCompletion],
  );

  const handleBlur = useCallback(() => {
    // A pointerdown on a popover row preventDefaults to keep the textarea
    // focused, so blur only fires on a genuine click-outside.
    setActiveCompletion(null);
  }, []);

  const insertCompletion = useCallback(
    (item: CompletionItem) => {
      const textarea = textareaRef.current;

      if (!textarea || !activeCompletion) {
        return;
      }

      const insertion = `${activeCompletion.trigger}${item.label} `;
      const before = value.slice(0, activeCompletion.triggerStart);
      const after = value.slice(activeCompletion.caret);
      const nextValue = before + insertion + after;
      const nextCaret = activeCompletion.triggerStart + insertion.length;

      onChange(nextValue);
      setActiveCompletion(null);

      requestAnimationFrame(() => {
        const current = textareaRef.current;
        if (!current) return;
        current.focus();
        current.setSelectionRange(nextCaret, nextCaret);
      });
    },
    [activeCompletion, onChange, value],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (activeCompletion && activeCompletion.matches.length > 0) {
        if (event.key === "ArrowDown") {
          event.preventDefault();
          event.stopPropagation();
          setActiveIndex((index) => (index + 1) % activeCompletion.matches.length);
          return;
        }

        if (event.key === "ArrowUp") {
          event.preventDefault();
          event.stopPropagation();
          setActiveIndex(
            (index) =>
              (index - 1 + activeCompletion.matches.length) % activeCompletion.matches.length,
          );
          return;
        }

        if (event.key === "Enter" || event.key === "Tab") {
          event.preventDefault();
          event.stopPropagation();
          const item = activeCompletion.matches[activeIndex];
          if (item) {
            insertCompletion(item);
          }
          return;
        }

        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          setActiveCompletion(null);
          return;
        }
      }

      if (event.key === "Escape" && actions.kind === "edit") {
        event.preventDefault();
        actions.onCancel();
      }
    },
    [actions, activeCompletion, activeIndex, insertCompletion],
  );

  // Track the popover anchor as long as a completion is active. The popover
  // uses position: fixed (so it can portal out without losing its place), so
  // we recompute on any ancestor scroll or window resize.
  useLayoutEffect(() => {
    if (!activeCompletion) {
      setPopoverPosition(null);
      return;
    }

    const update = () => {
      const textarea = textareaRef.current;
      if (!textarea) {
        return;
      }
      // Anchor the popover at the trigger character so it stays put as the
      // user types and the list filters; one line below the trigger so it
      // sits just under the text the user is composing.
      setPopoverPosition(resolveTextareaAnchor(textarea, activeCompletion.triggerStart));
    };

    update();

    // Capture-phase scroll listener catches scrolls in any ancestor.
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [activeCompletion]);

  return (
    <div className="documint-leaf-input-field">
      <textarea
        className="documint-leaf-input"
        onBlur={handleBlur}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onSelect={handleSelect}
        placeholder={placeholder}
        readOnly={readOnly}
        ref={textareaRef}
        rows={rows}
        value={value}
      />
      {renderActions(actions)}
      {activeCompletion && popoverPosition && activeCompletion.matches.length > 0 ? (
        <OverlayPortal>
          <CompletionPopover
            activeIndex={activeIndex}
            left={popoverPosition.left}
            matches={activeCompletion.matches}
            onHover={setActiveIndex}
            onSelect={insertCompletion}
            top={popoverPosition.top}
          />
        </OverlayPortal>
      ) : null}
    </div>
  );
});

function renderActions(actions: LeafInputActions) {
  if (actions.kind === "edit") {
    return (
      <>
        <LeafInputAction
          className="documint-leaf-input-cancel"
          icon={X}
          label="Cancel editing"
          onClick={actions.onCancel}
        />
        <LeafInputAction
          className="documint-leaf-input-save"
          disabled={actions.saveDisabled ?? false}
          icon={Check}
          label="Save"
          onClick={actions.onSave}
        />
      </>
    );
  }

  return (
    <LeafInputAction
      className="documint-leaf-input-submit"
      disabled={actions.submitDisabled ?? false}
      icon={SendHorizontal}
      iconSize={15}
      label={actions.submitLabel}
      onClick={actions.onSubmit}
    />
  );
}

// Icon button for the textarea's action chrome (cancel, save, submit). Keeps
// the renderActions branches focused on what each variant renders, not the
// repeated <button>/<Icon> markup.
function LeafInputAction({
  className,
  disabled = false,
  icon: Icon,
  iconSize = 14,
  label,
  onClick,
}: {
  className: string;
  disabled?: boolean;
  icon: LucideIcon;
  iconSize?: number;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-label={label}
      className={`documint-leaf-action ${className}`}
      disabled={disabled}
      onClick={onClick}
      title={label}
      type="button"
    >
      <Icon size={iconSize} strokeWidth={2.2} />
    </button>
  );
}

function CompletionPopover({
  activeIndex,
  left,
  matches,
  onHover,
  onSelect,
  top,
}: {
  activeIndex: number;
  left: number;
  matches: CompletionItem[];
  onHover: (index: number) => void;
  onSelect: (item: CompletionItem) => void;
  top: number;
}) {
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
    <div
      className="documint-leaf-menu documint-completion-popover"
      ref={containerRef}
      role="listbox"
      style={{
        position: "fixed",
        left,
        top,
        maxHeight: popoverMaxHeight,
        overflowY: "auto",
      }}
    >
      {matches.map((item, index) => {
        const isActive = index === activeIndex;
        return (
          <button
            aria-selected={isActive}
            className={`${completionItemBaseClass}${isActive ? " is-active" : ""}`}
            key={item.label}
            onPointerDown={preventTextareaBlur}
            onPointerEnter={() => onHover(index)}
            onClick={() => onSelect(item)}
            role="option"
            type="button"
          >
            <span>{item.label}</span>
          </button>
        );
      })}
    </div>
  );
}

// Keep the textarea focused when a popover row is clicked. Without this,
// the textarea blurs on pointerdown and tears down the popover before the
// click event can run our selection handler.
function preventTextareaBlur(event: PointerEvent<HTMLButtonElement>) {
  event.preventDefault();
}

function sortSources(sources: CompletionSource[] | undefined): CompletionSource[] {
  if (!sources?.length) return [];
  return sources.map((source) => ({
    trigger: source.trigger,
    items: [...source.items].sort((a, b) =>
      a.label.localeCompare(b.label, undefined, { sensitivity: "base" }),
    ),
  }));
}

function detectCompletionContext(
  value: string,
  caret: number,
  sources: CompletionSource[],
): ActiveCompletion | null {
  // Walk back from the caret looking for a trigger character. Stop early
  // on whitespace — that terminates any active completion context.
  for (let index = caret - 1; index >= 0; index -= 1) {
    const char = value[index];

    if (isCompletionBoundary(char)) {
      return null;
    }

    const source = sources.find((candidate) => candidate.trigger === char);
    if (!source) {
      continue;
    }

    // The trigger only counts if it sits at the start of the value or
    // immediately after whitespace — otherwise it's part of a word.
    if (index > 0 && !isCompletionBoundary(value[index - 1])) {
      return null;
    }

    const query = value.slice(index + 1, caret);
    return {
      trigger: source.trigger,
      query,
      triggerStart: index,
      caret,
      matches: filterItems(source.items, query),
    };
  }

  return null;
}

function isCompletionBoundary(char: string | undefined): boolean {
  return char === undefined || char === " " || char === "\n" || char === "\t";
}

function filterItems(items: CompletionItem[], query: string): CompletionItem[] {
  if (!query) return items;
  const needle = query.toLowerCase();
  return items.filter((item) => item.label.toLowerCase().includes(needle));
}
