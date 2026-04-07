import { forwardRef } from "react";
import { Check, X } from "lucide-react";

type EditInputProps = {
  className?: string;
  onCancel: () => void;
  onChange: (value: string) => void;
  onSave: () => void;
  placeholder?: string;
  readOnly?: boolean;
  rows?: number;
  saveDisabled?: boolean;
  value: string;
};

export const EditInput = forwardRef<HTMLTextAreaElement, EditInputProps>(function EditInput(
  {
    className,
    onCancel,
    onChange,
    onSave,
    placeholder,
    readOnly = false,
    rows = 3,
    saveDisabled = false,
    value,
  },
  ref,
) {
  return (
    <div className="documint-edit-input-field">
      <textarea
        className={className ?? "documint-comment-input"}
        onChange={(event) => onChange(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key !== "Escape") {
            return;
          }

          event.preventDefault();
          onCancel();
        }}
        placeholder={placeholder}
        readOnly={readOnly}
        ref={ref}
        rows={rows}
        value={value}
      />
      <button
        className="documint-leaf-action documint-edit-input-cancel"
        aria-label="Cancel editing"
        onClick={onCancel}
        title="Cancel editing"
        type="button"
      >
        <X size={14} strokeWidth={2.2} />
      </button>
      <button
        className="documint-leaf-action documint-edit-input-save"
        aria-label="Save"
        disabled={saveDisabled}
        onClick={onSave}
        title="Save"
        type="button"
      >
        <Check size={14} strokeWidth={2.2} />
      </button>
    </div>
  );
});
