import { useEffect, type CSSProperties } from "react";
import { Trash2, Users } from "lucide-react";
import type { DocumentPresence, DocumentUser } from "@lostintangent/documint";
import { describeEntry, useUsers, type UsersMode } from "../../hooks/useUsers";
import {
  PlaygroundPopover,
  popoverControlClassName,
  popoverHeaderClassName,
  popoverTitleClassName,
} from "./PlaygroundPopover";

type UsersPopoverProps = {
  content: string;
  onUsersChange: (users: DocumentUser[]) => void;
  onPresenceChange: (presence: DocumentPresence[]) => void;
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

const fieldLabelClassName = "font-controls grid gap-1.5";
const fieldCaptionClassName = "text-xs text-muted";
const fieldInputClassName = "w-full rounded-xl border border-border/15 bg-background/90 px-3 py-2";

export function UsersPopover({ content, onUsersChange, onPresenceChange }: UsersPopoverProps) {
  const { auto, manualEntries, manualForm, mode, presence, users } = useUsers(content);

  useEffect(() => {
    onUsersChange(users);
    onPresenceChange(presence);
  }, [onPresenceChange, onUsersChange, presence, users]);

  return (
    <PlaygroundPopover
      ariaLabel="Configure users"
      flyoutClassName="max-sm:portrait:gap-3 max-sm:portrait:p-3"
      icon={<Users size={16} strokeWidth={2.1} />}
      iconStyle={swatchStyleByMode[mode]}
      showSwatch={mode !== "empty"}
    >
      <div className={popoverHeaderClassName}>
        <strong className={popoverTitleClassName}>Users</strong>
        <label className="flex items-center gap-2.5">
          <input
            checked={auto.enabled}
            onChange={(event) => auto.setEnabled(event.target.checked)}
            type="checkbox"
          />
          <span>Auto</span>
        </label>
      </div>

      <div className="grid gap-3">
        <label className={fieldLabelClassName}>
          <span className={fieldCaptionClassName}>Name</span>
          <input
            className={fieldInputClassName}
            disabled={auto.enabled}
            onChange={(event) => manualForm.setName(event.target.value)}
            placeholder="Name"
            required
            type="text"
            value={manualForm.name}
          />
        </label>

        <label className={fieldLabelClassName}>
          <span className={fieldCaptionClassName}>Avatar URL</span>
          <input
            className={fieldInputClassName}
            disabled={auto.enabled}
            onChange={(event) => manualForm.setAvatarUrl(event.target.value)}
            placeholder="Optional avatar image"
            type="url"
            value={manualForm.avatarUrl}
          />
        </label>

        <label className={fieldLabelClassName}>
          <span className={fieldCaptionClassName}>Comment thread ID</span>
          <input
            className={fieldInputClassName}
            disabled={auto.enabled}
            onChange={(event) => manualForm.setThreadId(event.target.value)}
            placeholder="Optional thread target"
            type="text"
            value={manualForm.threadId}
          />
        </label>

        <label className={fieldLabelClassName}>
          <span className={fieldCaptionClassName}>Status</span>
          <input
            className={fieldInputClassName}
            disabled={auto.enabled}
            onChange={(event) => manualForm.setStatus(event.target.value)}
            placeholder="Reviewing comments"
            type="text"
            value={manualForm.status}
          />
        </label>

        <label className={fieldLabelClassName}>
          <span className={fieldCaptionClassName}>Prefix</span>
          <input
            className={fieldInputClassName}
            disabled={auto.enabled || manualForm.threadId.trim().length > 0}
            onChange={(event) => manualForm.setPrefix(event.target.value)}
            placeholder="Caret appears after this text"
            type="text"
            value={manualForm.prefix}
          />
        </label>

        <label className={fieldLabelClassName}>
          <span className={fieldCaptionClassName}>Suffix</span>
          <input
            className={fieldInputClassName}
            disabled={auto.enabled || manualForm.threadId.trim().length > 0}
            onChange={(event) => manualForm.setSuffix(event.target.value)}
            placeholder="Caret appears before this text"
            type="text"
            value={manualForm.suffix}
          />
        </label>

        <div className="grid grid-cols-[auto_minmax(0,1fr)] items-end gap-3">
          <label className={`${fieldLabelClassName} min-w-20`}>
            <span className={fieldCaptionClassName}>Color</span>
            <input
              className={`${fieldInputClassName} min-h-10 p-1.5`}
              disabled={auto.enabled}
              onChange={(event) => manualForm.setColor(event.target.value)}
              type="color"
              value={manualForm.color}
            />
          </label>

          <button
            className={`${popoverControlClassName} justify-self-end rounded-xl px-3 py-2`}
            disabled={auto.enabled || !manualForm.canAddEntry}
            onClick={() => manualForm.addEntry()}
            type="button"
          >
            Add
          </button>
        </div>
      </div>

      {auto.enabled ? (
        <p className="m-0 text-sm text-muted">
          {auto.presence
            ? `Auto user: ${describeEntry(auto.user, auto.presence)}`
            : "Auto user: waiting for a suitable text run"}
        </p>
      ) : manualEntries.items.length > 0 ? (
        <>
          <div aria-hidden="true" className="h-px bg-border/15" />
          <div className="grid gap-3">
            {manualEntries.items.map((entry) => (
              <div className="flex min-w-0 items-center gap-2.5" key={entry.user.id}>
                <span
                  aria-hidden="true"
                  className="size-3 rounded-full shadow-swatch"
                  style={{ backgroundColor: entry.presence.color ?? "#0ea5e9" }}
                />
                <span className="min-w-0 flex-1 truncate">
                  {describeEntry(entry.user, entry.presence)}
                </span>
                <button
                  aria-label={`Remove ${describeEntry(entry.user, entry.presence)}`}
                  className="inline-flex cursor-pointer items-center justify-center border-0 bg-transparent p-1 text-red-600"
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
