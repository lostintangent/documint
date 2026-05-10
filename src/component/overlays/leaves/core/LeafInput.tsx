// Shared text input for leaves, which provides inline actions for cancelling
// and saving an edit action, as well as configurable auto-completion (e.g. @mentions).

import { Check, SendHorizontal, X, type LucideIcon } from "lucide-react";
import { CompletionLeaf } from "../CompletionLeaf";
import { type CompletionSource } from "../../../completions/completions";
import { useCallback, useRef, type KeyboardEvent, type RefObject } from "react";
import { useLeafInputCompletions } from "./useLeafInputCompletions";
import { LeafAnchor } from "./LeafAnchor";

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
    <div className="documint-leaf-input-field">
      <textarea
        autoFocus={autoFocus}
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
    >
      <Icon size={iconSize} strokeWidth={2.2} />
    </button>
  );
}
