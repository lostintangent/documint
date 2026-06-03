// Shared text input for leaves, which provides inline actions for cancelling
// and saving an edit action, as well as configurable auto-completion (e.g. @mentions).

import { Check, SendHorizontal, X } from "lucide-react";
import { CompletionLeaf } from "../CompletionLeaf";
import { type CompletionSource } from "../../../../completions/completions";
import { useCallback, useRef, type KeyboardEvent, type RefObject } from "react";
import { useLeafInputCompletions } from "./useLeafInputCompletions";
import { LeafAnchor } from "../anchor/LeafAnchor";
import { LeafButton, type LeafButtonProps } from "../LeafButton";
import { clx } from "../lib/clx";

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
  autoFocus?: boolean;
  completionSources?: CompletionSource[];
  onChange: (value: string) => void;
  placeholder?: string;
  readOnly?: boolean;
  ref?: RefObject<HTMLTextAreaElement | null>;
  rows?: number;
  saveOnEnter?: boolean;
  value: string;
};

export function LeafInput({
  actions,
  autoFocus = false,
  completionSources,
  onChange,
  placeholder,
  readOnly = false,
  ref,
  rows = 3,
  saveOnEnter = false,
  value,
}: LeafInputProps) {
  const fallbackRef = useRef<HTMLTextAreaElement | null>(null);
  const textareaRef = ref ?? fallbackRef;

  const {
    activeCompletion,
    anchor: completionAnchor,
    handleBlur,
    handleChange,
    handleKeyDown: handleCompletionKeyDown,
    handleSelect,
    leafProps,
  } = useLeafInputCompletions({
    completionSources,
    onChange,
    textareaRef,
    value,
  });

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (handleCompletionKeyDown(event)) return;

      if (event.key === "Escape" && actions.kind === "edit") {
        event.preventDefault();
        actions.onCancel();
      }

      if (event.key === "Enter" && saveOnEnter) {
        event.preventDefault();
        if (actions.kind === "edit" && !actions.saveDisabled) {
          actions.onSave();
        } else if (actions.kind === "compose" && !actions.submitDisabled) {
          actions.onSubmit();
        }
      }
    },
    [actions, handleCompletionKeyDown, saveOnEnter],
  );

  return (
    <div className="relative w-full min-w-0">
      <textarea
        autoFocus={autoFocus}
        className="box-border w-full min-h-18 pt-2.5 pr-12 pb-3 pl-3 border border-leaf-border rounded-xl bg-leaf-input-bg text-leaf-text [font:inherit] wrap-anywhere resize-none placeholder:text-leaf-secondary"
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
      {activeCompletion && completionAnchor && leafProps ? (
        <LeafAnchor anchor={completionAnchor}>
          <CompletionLeaf {...leafProps} />
        </LeafAnchor>
      ) : null}
    </div>
  );
}

function renderActions(actions: LeafInputActions) {
  if (actions.kind === "edit") {
    return (
      <>
        <LeafInputAction
          icon={X}
          onClick={actions.onCancel}
          placement="top"
          title="Cancel editing"
        />
        <LeafInputAction
          disabled={actions.saveDisabled ?? false}
          icon={Check}
          onClick={actions.onSave}
          title="Save"
        />
      </>
    );
  }

  return (
    <LeafInputAction
      disabled={actions.submitDisabled ?? false}
      icon={SendHorizontal}
      iconSize={15}
      onClick={actions.onSubmit}
      title={actions.submitLabel}
    />
  );
}

// Icon button for the textarea's action chrome (cancel, save, submit). Keeps
// the renderActions branches focused on what each variant renders, not the
// repeated <button>/<Icon> markup.
function LeafInputAction({
  className,
  placement = "bottom",
  ...props
}: Omit<LeafButtonProps, "hover"> & { placement?: "top" | "bottom" }) {
  return (
    <LeafButton
      {...props}
      className={clx(
        // The `+3px` on the bottom variant is an optical adjustment so the
        // save button visually aligns with the textarea's baseline of typed
        // text, not just with the matching `top-3` offset of the cancel.
        "absolute right-3",
        placement === "top" ? "top-3" : "bottom-[calc(0.75rem+3px)]",
        className,
      )}
      hover="input"
    />
  );
}
