// Link editor leaf — shows the URL with edit/delete actions in read mode
// and swaps to a textarea (via LeafInput) when the user begins editing. The
// shell width is driven by the inner `.documint-link-leaf` div's CSS so the
// leaf shrink-fits to its content like every other leaf type.
import { Pencil, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { LeafInput } from "./core/LeafInput";

type LinkLeafProps = {
  canEdit: boolean;
  onDelete: () => void;
  onSave: (url: string) => void;
  title: string | null;
  url: string;
};

export function LinkLeaf({ canEdit, onDelete, onSave, title, url }: LinkLeafProps) {
  const [draftUrl, setDraftUrl] = useState(url);
  const [isEditing, setIsEditing] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const openModifierLabel = resolveOpenModifierLabel();
  const nextUrl = draftUrl.trim();
  const canSave = canEdit && nextUrl.length > 0;
  const showActions = canEdit && !isEditing;
  const hintText = `${openModifierLabel}click to open`;
  const rowClassName = `documint-link-leaf-row${isEditing ? " is-editing" : ""}`;

  useEffect(() => {
    if (isEditing) {
      return;
    }

    setDraftUrl(url);
  }, [isEditing, url]);

  useEffect(() => {
    if (!isEditing) {
      return;
    }

    inputRef.current?.focus();
  }, [isEditing]);

  const beginEditing = () => {
    if (!canEdit) {
      return;
    }

    setDraftUrl(url);
    setIsEditing(true);
  };

  const cancelEditing = () => {
    setDraftUrl(url);
    setIsEditing(false);
  };

  const saveLink = () => {
    onSave(nextUrl);
    setIsEditing(false);
  };

  return (
    <div className="documint-link-leaf">
      {title ? <div className="documint-link-leaf-title">{title}</div> : null}
      <div className={rowClassName}>
        {isEditing ? (
          <LeafInput
            actions={{
              kind: "edit",
              onCancel: cancelEditing,
              onSave: saveLink,
              saveDisabled: !canSave,
            }}
            onChange={setDraftUrl}
            readOnly={!canEdit}
            ref={inputRef}
            rows={3}
            value={draftUrl}
          />
        ) : (
          <div className="documint-link-leaf-url">{url}</div>
        )}
        {showActions ? (
          <div className="documint-link-leaf-actions">
            <button
              className="documint-leaf-action"
              aria-label="Edit link"
              onClick={beginEditing}
              title="Edit link"
              type="button"
            >
              <Pencil size={14} strokeWidth={2.2} />
            </button>
            <button
              className="documint-leaf-action documint-leaf-action-danger"
              aria-label="Remove link"
              onClick={onDelete}
              title="Remove link"
              type="button"
            >
              <Trash2 size={14} strokeWidth={2.2} />
            </button>
          </div>
        ) : null}
      </div>
      <div className="documint-link-leaf-divider" />
      <div className="documint-link-leaf-hint">{hintText}</div>
    </div>
  );
}

function resolveOpenModifierLabel() {
  if (typeof navigator === "undefined") {
    return "Ctrl+";
  }

  const platform = navigator.platform || navigator.userAgent;

  return /Mac|iPhone|iPad|iPod/.test(platform) ? "CMD+" : "CTRL+";
}
