// When you hover or focus on a link, this leaf displays the
// link's associated URL and allows you to edit it. It also
// provides a hint to CMD/CTRL+click to open the link.

import { Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import { LeafInput } from "./core/LeafInput";

type LinkLeafProps = {
  url: string;
  title: string | null;
  canEdit: boolean;
  onSave: (url: string) => void;
  onDelete: () => void;  
};

export function LinkLeaf({ title, url, canEdit, onSave, onDelete }: LinkLeafProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [draftUrl, setDraftUrl] = useState("");

  const decodedUrl = safeDecodeUrl(url);
  const faviconUrl = resolveFaviconUrl(url);

  const showActions = canEdit && !isEditing;
  const canSave = canEdit && draftUrl.trim().length > 0;

  const openModifierLabel = resolveOpenModifierLabel();

  const beginEditing = () => {
    if (!canEdit) {
      return;
    }

    setDraftUrl(decodedUrl);
    setIsEditing(true);
  };

  const saveLink = () => {
    onSave(encodeURI(draftUrl.trim()));
    setIsEditing(false);
  };

  return (
    <div className="documint-link-leaf">
      {title && <div className="documint-link-leaf-title">{title}</div>}

      <div className="documint-link-leaf-row">

        {isEditing ? (
          <LeafInput
            actions={{
              kind: "edit",
              onCancel: () => setIsEditing(false),
              onSave: saveLink,
              saveDisabled: !canSave,
            }}
            autoFocus
            onChange={setDraftUrl}
            readOnly={!canEdit}
            rows={3}
            saveOnEnter
            value={draftUrl}
          />
        ) : (
          <div className="documint-link-leaf-url-row">
            {faviconUrl && (
              <img
                className="documint-link-leaf-favicon"
                key={faviconUrl}
                onError={(e) => { e.currentTarget.hidden = true; }}
                src={faviconUrl}
              />
            )}
            <div className="documint-link-leaf-url">{decodedUrl}</div>
          </div>
        )}

        {showActions && (
          <div className="documint-link-leaf-actions">
            <button
              className="documint-leaf-action"
              aria-label="Edit link"
              onClick={beginEditing}
              title="Edit link"
            >
              <Pencil size={14} strokeWidth={2.2} />
            </button>

            <button
              className="documint-leaf-action documint-leaf-action-danger"
              aria-label="Remove link"
              onClick={onDelete}
              title="Remove link"
            >
              <Trash2 size={14} strokeWidth={2.2} />
            </button>
          </div>
        )}

      </div>

      {/* CMD+click hint */}
      <div className="documint-link-leaf-divider" />
      <div className="documint-link-leaf-hint">{openModifierLabel}click to open</div>

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

function safeDecodeUrl(url: string): string {
  try {
    return decodeURIComponent(url);
  } catch {
    return url;
  }
}

function resolveFaviconUrl(url: string): string | null {
  try {
    const { hostname } = new URL(url);
    return `https://www.google.com/s2/favicons?domain=${hostname}&sz=32`;
  } catch {
    return null;
  }
}
