import { ArrowDown, ArrowUp } from "lucide-react";
import type { CSSProperties } from "react";
import type { EditorPresence } from "@/editor";
import { resolvePresenceName } from "../lib/presence";
import { LeafDivider } from "./leaves/core/LeafDivider";

type PresenceOverlayProps = {
  onSelect: (presence: EditorPresence) => void;
  presence: EditorPresence[] | undefined;
};

export function PresenceOverlay({ onSelect, presence }: PresenceOverlayProps) {
  if (!presence) {
    return null;
  }

  return (
    <div aria-label="Presence" className="documint-presence-indicators">
      {presence.map((entry) => (
        <PresenceIndicator key={entry.id} onSelect={() => onSelect(entry)} presence={entry} />
      ))}
    </div>
  );
}

function PresenceIndicator({
  onSelect,
  presence,
}: {
  onSelect: () => void;
  presence: EditorPresence;
}) {
  const viewport = presence.viewport;
  const initial = resolvePresenceInitial(presence);
  const status = resolvePresenceStatus(presence);
  const DirectionIcon = viewport?.status === "above" ? ArrowUp : ArrowDown;
  const canScrollToPresence = viewport !== null && viewport.status !== "unresolved";
  const showDirection = viewport?.status === "above" || viewport?.status === "below";

  return (
    <div
      className="documint-presence-indicator-row"
      style={
        {
          "--documint-presence-color": presence.color ?? "var(--documint-leaf-accent)",
        } as CSSProperties
      }
    >
      <button
        aria-label={resolvePresenceAriaLabel(presence)}
        className="documint-presence-indicator"
        data-status={viewport?.status ?? "unresolved"}
        disabled={!canScrollToPresence}
        onClick={canScrollToPresence ? onSelect : undefined}
        type="button"
      >
        <span className="documint-presence-indicator-avatar">
          {presence.avatarUrl ? (
            <img
              alt=""
              aria-hidden="true"
              className="documint-presence-indicator-image"
              draggable={false}
              src={presence.avatarUrl}
            />
          ) : (
            initial
          )}
        </span>
        {status ? <span className="documint-presence-indicator-status">{status}</span> : null}
        {status && showDirection ? <LeafDivider orientation="vertical" /> : null}
        {showDirection ? (
          <span className="documint-presence-indicator-direction" aria-hidden="true">
            <DirectionIcon
              className="documint-presence-indicator-arrow"
              size={14}
              strokeWidth={2.3}
            />
          </span>
        ) : null}
      </button>
    </div>
  );
}

function resolvePresenceInitial(presence: EditorPresence) {
  return resolvePresenceName(presence).charAt(0).toLocaleUpperCase();
}

function resolvePresenceAriaLabel(presence: EditorPresence) {
  const name = resolvePresenceName(presence);
  const status = presence.viewport?.status ?? "unresolved";

  if (status === "above") {
    return `${name} above viewport`;
  }

  if (status === "below") {
    return `${name} below viewport`;
  }

  if (status === "unresolved") {
    return `${name} unresolved`;
  }

  return `${name} in viewport`;
}

function resolvePresenceStatus(presence: EditorPresence) {
  const status = presence.status?.trim();
  return status ? status : null;
}
