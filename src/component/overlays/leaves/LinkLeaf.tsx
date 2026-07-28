// Leaf shown when the caret hovers or lands on a link span: displays the
// URL with a favicon, an inline editor when opened, and a modifier-key
// hint for opening the link in a new tab.

import { Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import { LeafButton } from "./core/LeafButton";
import { LeafDivider } from "./core/LeafDivider";
import { LeafInput } from "./core/input/LeafInput";
import { resolveEditorPlatform } from "../../lib/platform";

type LinkLeafProps = {
  url: string;
  title: string | null;
  canEdit: boolean;
  onSave: (url: string) => void;
  onDelete: () => void;
};

// Detected once at module load — the user's OS won't change while the
// editor is alive.
const OPEN_MODIFIER_LABEL = resolveEditorPlatform() === "mac" ? "CMD+" : "CTRL+";

export function LinkLeaf({ title, url, canEdit, onSave, onDelete }: LinkLeafProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [draftUrl, setDraftUrl] = useState("");

  const decodedUrl = safeDecodeUrl(url);
  const faviconUrl = resolveFaviconUrl(url);
  const showActions = canEdit && !isEditing;
  const canSave = canEdit && draftUrl.trim().length > 0;

  const beginEditing = () => {
    setDraftUrl(decodedUrl);
    setIsEditing(true);
  };

  const cancelEditing = () => setIsEditing(false);

  const saveLink = () => {
    onSave(encodeURI(draftUrl.trim()));
    setIsEditing(false);
  };

  return (
    <div className="p-3 grid gap-1.5 min-w-0 w-[min(16rem,calc(100vw-4rem))]">
      {title && <div className="text-leaf-text text-xs font-semibold">{title}</div>}

      {/* Row uses a second `auto` track for the action buttons when
          they're shown; collapses to a single track so the editor input
          fills the available width. */}
      <div
        className={`grid items-center gap-2.5 ${
          showActions ? "grid-cols-[minmax(0,1fr)_auto]" : "grid-cols-1"
        }`}
      >
        {isEditing ? (
          <LeafInput
            actions={{
              kind: "edit",
              onCancel: cancelEditing,
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
          <div className="flex items-center gap-1.5 min-w-0">
            {faviconUrl && (
              <img
                alt=""
                aria-hidden="true"
                className="flex-none w-4 h-4 rounded-xs"
                key={faviconUrl}
                onError={(event) => {
                  event.currentTarget.hidden = true;
                }}
                src={faviconUrl}
              />
            )}
            <div className="min-w-0 text-leaf-secondary text-xs wrap-anywhere">{decodedUrl}</div>
          </div>
        )}

        {showActions && (
          <div className="inline-flex items-center gap-2">
            <LeafButton icon={Pencil} onClick={beginEditing} title="Edit link" />
            <LeafButton danger icon={Trash2} onClick={onDelete} title="Remove link" />
          </div>
        )}
      </div>

      {!isEditing && (
        <>
          <LeafDivider />
          <div className="text-leaf-secondary text-xs italic">
            {OPEN_MODIFIER_LABEL}click to open
          </div>
        </>
      )}
    </div>
  );
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
