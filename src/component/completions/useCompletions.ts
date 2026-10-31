import { useEffect, useRef, useState } from "react";
import type { ActiveCompletion, CompletionItem } from "./completions";

type CompletionKeyboardEvent = {
  key: string;
  preventDefault: () => void;
  stopPropagation: () => void;
};

type CompletionBeforeInputEvent = {
  inputType: string;
  preventDefault: () => void;
  stopPropagation: () => void;
};

export type CompletionLeafProps = {
  activeIndex: number;
  matches: readonly CompletionItem[];
  onHover: (index: number) => void;
  onSelect: (item: CompletionItem) => void;
};

export type CompletionController = {
  activeIndex: number;
  handleBeforeInput: (event: CompletionBeforeInputEvent) => boolean;
  handleKeyDown: (event: CompletionKeyboardEvent) => boolean;
  leafProps: CompletionLeafProps | null;
};

export function useCompletions<TCompletion extends ActiveCompletion>({
  activeCompletion,
  contextKey,
  onAccept,
  onDismiss,
}: {
  activeCompletion: TCompletion | null;
  contextKey?: string | null;
  onAccept: (item: CompletionItem, completion: TCompletion) => void;
  onDismiss?: () => void;
}): CompletionController {
  const [activeIndex, setActiveIndex] = useState(0);
  const [indexKey, setIndexKey] = useState<string | null>(null);
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);
  const suppressAcceptBeforeInputRef = useRef(false);
  const acceptedKeyRef = useRef<string | null>(null);
  const activeKey = activeCompletion
    ? (contextKey ?? completionContextKey(activeCompletion))
    : null;
  const visibleCompletion = activeKey === dismissedKey ? null : activeCompletion;
  const effectiveActiveIndex = visibleCompletion
    ? Math.min(activeIndex, Math.max(0, visibleCompletion.matches.length - 1))
    : activeIndex;

  // A new completion context starts at the first match and clears any prior
  // dismissal. Adjusting during render avoids a stale frame.
  if (indexKey !== activeKey) {
    setIndexKey(activeKey);
    setActiveIndex(0);
  }

  if (dismissedKey !== null && activeKey !== dismissedKey) {
    setDismissedKey(null);
  }

  useEffect(() => {
    acceptedKeyRef.current = null;
  }, [activeKey]);

  const acceptCompletion = (item: CompletionItem) => {
    if (!visibleCompletion || !activeKey || acceptedKeyRef.current === activeKey) {
      return;
    }

    // Accepting consumes the current completion context immediately. React
    // and store updates land after this event returns, but mobile keyboards
    // can emit follow-up input events synchronously around Return.
    acceptedKeyRef.current = activeKey;
    setDismissedKey(activeKey);
    onAccept(item, visibleCompletion);
  };

  const handleKeyDown = (event: CompletionKeyboardEvent) => {
    if (!visibleCompletion || visibleCompletion.matches.length === 0) {
      return false;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      event.stopPropagation();
      setActiveIndex((index) => (index + 1) % visibleCompletion.matches.length);
      return true;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      event.stopPropagation();
      setActiveIndex(
        (index) =>
          (index - 1 + visibleCompletion.matches.length) % visibleCompletion.matches.length,
      );
      return true;
    }

    if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      event.stopPropagation();
      suppressAcceptBeforeInputRef.current = true;
      const item = visibleCompletion.matches[effectiveActiveIndex];
      if (item) {
        acceptCompletion(item);
      }
      return true;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setDismissedKey(activeKey);
      onDismiss?.();
      return true;
    }

    return false;
  };

  const handleBeforeInput = (event: CompletionBeforeInputEvent) => {
    if (suppressAcceptBeforeInputRef.current && isCompletionAcceptInputType(event.inputType)) {
      suppressAcceptBeforeInputRef.current = false;
      event.preventDefault();
      event.stopPropagation();
      return true;
    }

    if (!visibleCompletion || visibleCompletion.matches.length === 0) {
      suppressAcceptBeforeInputRef.current = false;
      return false;
    }

    // While the menu is open, OS autocorrect/replacement would rewrite the
    // query underneath the active list (e.g. iOS can change ":fi" to ":if").
    if (isCompletionNativeReplacementInputType(event.inputType)) {
      event.preventDefault();
      event.stopPropagation();
      return true;
    }

    if (!isCompletionAcceptInputType(event.inputType)) {
      suppressAcceptBeforeInputRef.current = false;
      return false;
    }

    event.preventDefault();
    event.stopPropagation();
    const item = visibleCompletion.matches[effectiveActiveIndex];
    if (item) {
      acceptCompletion(item);
    }
    return true;
  };

  const leafProps =
    visibleCompletion && visibleCompletion.matches.length > 0
      ? {
          activeIndex: effectiveActiveIndex,
          matches: visibleCompletion.matches,
          onHover: setActiveIndex,
          onSelect: acceptCompletion,
        }
      : null;

  return {
    activeIndex: effectiveActiveIndex,
    handleBeforeInput,
    handleKeyDown,
    leafProps,
  };
}

function isCompletionAcceptInputType(inputType: string) {
  return inputType === "insertLineBreak" || inputType === "insertParagraph";
}

function isCompletionNativeReplacementInputType(inputType: string) {
  return inputType === "insertReplacementText";
}

function completionContextKey(completion: ActiveCompletion) {
  return [completion.trigger, completion.triggerStart, completion.caret, completion.query].join(
    ":",
  );
}
