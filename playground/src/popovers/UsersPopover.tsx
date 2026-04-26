import { useEffect, useRef, type CSSProperties } from "react";
import { Trash2, Users } from "lucide-react";
import type { DocumentPresence, DocumentUser } from "documint";
import { describeEntry, useUsers, type UsersMode } from "../hooks/useUsers";
import { PlaygroundPopover } from "./PlaygroundPopover";

type UsersPopoverProps = {
  content: string;
  onUsersChange: (users: DocumentUser[]) => void;
  onPresenceChange: (presence: DocumentPresence[]) => void;
  resetKey: string;
};

const swatchStyleByMode: Record<UsersMode, CSSProperties | undefined> = {
  auto: {
    background: "rgba(14, 165, 233, 0.14)",
    borderColor: "rgba(14, 165, 233, 0.34)",
    color: "#0284c7",
  },
  manual: {
    background: "rgba(22, 163, 74, 0.14)",
    borderColor: "rgba(22, 163, 74, 0.34)",
    color: "#15803d",
  },
  empty: undefined,
};

const iconClassNameByMode: Record<UsersMode, string> = {
  auto: "presence-toggle-icon presence-toggle is-auto",
  manual: "presence-toggle-icon presence-toggle is-manual",
  empty: "presence-toggle-icon presence-toggle",
};

export function UsersPopover({
  content,
  onUsersChange,
  onPresenceChange,
  resetKey,
}: UsersPopoverProps) {
  const previousResetKeyRef = useRef(resetKey);
  const { auto, manualEntries, manualForm, mode, presence, reset, users } = useUsers(content);

  useEffect(() => {
    if (previousResetKeyRef.current !== resetKey) {
      previousResetKeyRef.current = resetKey;
      reset();
      onUsersChange([]);
      onPresenceChange([]);
      return;
    }

    onUsersChange(users);
    onPresenceChange(presence);
  }, [onPresenceChange, onUsersChange, presence, reset, resetKey, users]);

  return (
    <PlaygroundPopover
      ariaLabel="Configure users"
      containerClassName="presence-controls"
      flyoutClassName="presence-flyout"
      icon={<Users size={16} strokeWidth={2.1} />}
      iconClassName={iconClassNameByMode[mode]}
      iconStyle={swatchStyleByMode[mode]}
      showSwatch={mode !== "empty"}
    >
      <div className="presence-header">
        <strong>Users</strong>
        <label className="presence-checkbox">
          <input
            checked={auto.enabled}
            onChange={(event) => auto.setEnabled(event.target.checked)}
            type="checkbox"
          />
          <span>Auto</span>
        </label>
      </div>

      <div className="presence-manual">
        <label className="fixture-picker">
          <span>Name</span>
          <input
            disabled={auto.enabled}
            onChange={(event) => manualForm.setName(event.target.value)}
            placeholder="Name"
            required
            type="text"
            value={manualForm.name}
          />
        </label>

        <label className="fixture-picker">
          <span>Avatar URL</span>
          <input
            disabled={auto.enabled}
            onChange={(event) => manualForm.setAvatarUrl(event.target.value)}
            placeholder="Optional avatar image"
            type="url"
            value={manualForm.avatarUrl}
          />
        </label>

        <label className="fixture-picker">
          <span>Prefix</span>
          <input
            disabled={auto.enabled}
            onChange={(event) => manualForm.setPrefix(event.target.value)}
            placeholder="Caret appears after this text"
            type="text"
            value={manualForm.prefix}
          />
        </label>

        <label className="fixture-picker">
          <span>Suffix</span>
          <input
            disabled={auto.enabled}
            onChange={(event) => manualForm.setSuffix(event.target.value)}
            placeholder="Caret appears before this text"
            type="text"
            value={manualForm.suffix}
          />
        </label>

        <div className="presence-manual-row">
          <label className="fixture-picker presence-color-picker">
            <span>Color</span>
            <input
              disabled={auto.enabled}
              onChange={(event) => manualForm.setColor(event.target.value)}
              type="color"
              value={manualForm.color}
            />
          </label>

          <button
            className="presence-add"
            disabled={auto.enabled || !manualForm.canAddEntry}
            onClick={manualForm.addEntry}
            type="button"
          >
            Add
          </button>
        </div>
      </div>

      {auto.enabled ? (
        <p className="presence-status">
          {auto.presence
            ? `Auto user: ${describeEntry(auto.user, auto.presence)}`
            : "Auto user: waiting for a suitable text run"}
        </p>
      ) : manualEntries.items.length > 0 ? (
        <>
          <div aria-hidden="true" className="presence-divider" />
          <div className="presence-list">
            {manualEntries.items.map((entry) => (
              <div className="presence-chip" key={entry.user.id}>
                <span
                  aria-hidden="true"
                  className="presence-chip-swatch"
                  style={{ backgroundColor: entry.presence.color ?? "#0ea5e9" }}
                />
                <span>{describeEntry(entry.user, entry.presence)}</span>
                <button
                  aria-label={`Remove ${describeEntry(entry.user, entry.presence)}`}
                  className="presence-remove"
                  onClick={() => manualEntries.removeEntry(entry.user.id)}
                  type="button"
                >
                  <Trash2 aria-hidden="true" size={14} strokeWidth={2.1} />
                </button>
              </div>
            ))}
          </div>
        </>
      ) : null}
    </PlaygroundPopover>
  );
}
