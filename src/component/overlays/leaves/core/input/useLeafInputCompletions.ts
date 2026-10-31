// LeafInput-specific adapter around the shared completion primitives. It owns
// textarea state, textarea anchoring, focus restoration, and leaf-input blur
// behavior; document-level completion should use a separate adapter.

import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type RefObject,
  type SyntheticEvent,
} from "react";
import { useCompletions, type CompletionLeafProps } from "../../../../completions/useCompletions";
import {
  detectCompletionContext,
  resolveCompletionInsertion,
  type ActiveCompletion,
  type CompletionItem,
  type CompletionSource,
} from "../../../../completions/completions";
import { resolveTextareaAnchor } from "./textarea-anchor";
import type { DocumentAnchorResolution } from "../shared";

export type LeafInputCompletionsController = {
  anchor: DocumentAnchorResolution | null;
  leafProps: CompletionLeafProps | null;
  handleBlur: () => void;
  handleChange: (event: ChangeEvent<HTMLTextAreaElement>) => void;
  handleKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => boolean;
  handleSelect: (event: SyntheticEvent<HTMLTextAreaElement>) => void;
};

export function useLeafInputCompletions({
  completionSources,
  onChange,
  textareaRef,
  value,
}: {
  completionSources?: CompletionSource[];
  onChange: (value: string) => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  value: string;
}): LeafInputCompletionsController {
  const [activeCompletion, setActiveCompletion] = useState<ActiveCompletion | null>(null);
  const [anchor, setAnchor] = useState<DocumentAnchorResolution | null>(null);
  const activeTriggerStart = activeCompletion?.triggerStart ?? null;

  const updateActiveCompletion = (nextValue: string, caret: number) => {
    if (!completionSources?.length) {
      setActiveCompletion(null);
      return;
    }

    const detected = detectCompletionContext(nextValue, caret, completionSources);

    if (!detected) {
      setActiveCompletion(null);
      return;
    }

    setActiveCompletion(detected);
  };

  const handleChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    const nextValue = event.currentTarget.value;
    const caret = event.currentTarget.selectionEnd ?? nextValue.length;

    onChange(nextValue);
    updateActiveCompletion(nextValue, caret);
  };

  const handleSelect = (event: SyntheticEvent<HTMLTextAreaElement>) => {
    const textarea = event.currentTarget;
    updateActiveCompletion(textarea.value, textarea.selectionEnd ?? textarea.value.length);
  };

  const handleBlur = () => {
    // A pointerdown on a popover row preventDefaults to keep the textarea
    // focused, so blur only fires on a genuine click-outside.
    setActiveCompletion(null);
  };

  const acceptCompletion = (item: CompletionItem, completion: ActiveCompletion) => {
    const textarea = textareaRef.current;

    if (!textarea) {
      return;
    }

    const insertion = resolveCompletionInsertion(value, completion, item);

    onChange(insertion.value);
    setActiveCompletion(null);

    requestAnimationFrame(() => {
      const current = textareaRef.current;
      if (!current) return;
      current.focus();
      current.setSelectionRange(insertion.caret, insertion.caret);
    });
  };

  const completion = useCompletions({
    activeCompletion,
    onAccept: acceptCompletion,
    onDismiss: handleBlur,
  });

  const handleNativeBeforeInput = useEffectEvent((event: Event) => {
    completion.handleBeforeInput(event as InputEvent);
  });

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }

    textarea.addEventListener("beforeinput", handleNativeBeforeInput);
    return () => textarea.removeEventListener("beforeinput", handleNativeBeforeInput);
  }, [textareaRef]);

  // Track the completion anchor as long as a completion is active. LeafInput
  // passes this document-absolute anchor without an origin, so it keeps working
  // when iOS scrolls the page to accommodate the virtual keyboard. Recompute on
  // ancestor scroll and viewport resize because the source textarea can move
  // inside any host container.
  if (activeTriggerStart === null && anchor !== null) {
    setAnchor(null);
  }

  useLayoutEffect(() => {
    if (activeTriggerStart === null) {
      return;
    }

    const update = () => {
      const textarea = textareaRef.current;
      if (!textarea) {
        return;
      }
      // Anchor the completion at the trigger character so it stays put as the
      // user types and the list filters; one line below the trigger so it
      // sits just under the text the user is composing.
      const resolved = resolveTextareaAnchor(textarea, activeTriggerStart);
      setAnchor(
        resolved
          ? {
              anchorHeight: resolved.anchorHeight,
              bridge: false,
              left: resolved.left,
              paddingY: 4,
              top: resolved.top,
            }
          : null,
      );
    };

    update();

    // Capture-phase scroll listener catches scrolls in any ancestor.
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [activeTriggerStart, textareaRef]);

  return {
    anchor,
    handleBlur,
    handleChange,
    handleKeyDown: completion.handleKeyDown,
    handleSelect,
    leafProps: completion.leafProps,
  };
}
