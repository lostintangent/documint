/**
 * Editor-side resolution of host-provided presence cursors.
 *
 * Presence is ephemeral overlay state — a remote user's caret, provided by
 * the host as a content-addressable anchor. This module owns the semantic
 * step of placing each cursor in the current document via the shared anchor
 * algebra; geometric measurement (where it shows up in the viewport) is left
 * to layout/paint.
 */

import { findContextRanges, findOccurrences, type Anchor, type AnchorContainer } from "@/document";
import type { DocumentUserPresence } from "@/types";
import type { DocumentIndex, EditorSelectionPoint } from "../state";
import { projectAnchorContainersToEditor } from "./index";

// --- Types ---

// Where a presence sits relative to the prepared viewport. `scrollTop` is the
// y-position the host would scroll to to bring this cursor into view; it only
// exists when the cursor was geometrically resolvable, so `unresolved` lacks
// it by construction.
export type EditorPresenceViewport =
  | { status: "unresolved" }
  | { status: "above" | "below" | "visible"; scrollTop: number };

export type EditorPresenceViewportStatus = EditorPresenceViewport["status"];

export type EditorPresence = DocumentUserPresence & {
  cursorPoint: EditorSelectionPoint | null;
  viewport: EditorPresenceViewport | null;
};

type PresenceMatch = {
  container: AnchorContainer;
  offset: number;
};

// --- Public API ---

// Resolve each host-provided presence into an editor-side cursor point.
// Cursors that don't resolve unambiguously (no match, or multiple equally
// good matches) come back with `cursorPoint: null` so the caller can hide
// them rather than guess.
export function resolvePresenceCursors(
  documentIndex: DocumentIndex,
  presence: DocumentUserPresence[],
): EditorPresence[] {
  if (presence.length === 0) {
    return [];
  }

  const containerProjection = projectAnchorContainersToEditor(documentIndex);
  const semanticContainers = containerProjection.list();

  return presence.map((presenceItem) => ({
    ...presenceItem,
    cursorPoint: resolvePresenceCursorPoint(presenceItem, semanticContainers, containerProjection),
    viewport: null,
  }));
}

// --- Internal helpers ---

function resolvePresenceCursorPoint(
  presence: DocumentUserPresence,
  semanticContainers: AnchorContainer[],
  containerProjection: ReturnType<typeof projectAnchorContainersToEditor>,
) {
  if (!presence.cursor) {
    return null;
  }

  const candidateContainers = filterAnchorContainers(semanticContainers, presence.cursor);
  const matches = collectAnchorMatches(candidateContainers, presence.cursor);

  if (matches.length !== 1) {
    return null;
  }

  const match = matches[0]!;
  const runtimeContainer = containerProjection.resolveRuntimeContainer(match.container.id);

  if (!runtimeContainer) {
    return null;
  }

  return {
    offset: Math.max(0, Math.min(match.offset, runtimeContainer.text.length)),
    regionId: runtimeContainer.id,
  };
}

function filterAnchorContainers(containers: AnchorContainer[], anchor: Anchor) {
  return anchor.kind
    ? containers.filter((container) => container.containerKind === anchor.kind)
    : containers;
}

// Dispatch on which side of the anchor descriptor is present. Presence does
// not score; it requires an unambiguous match, so each branch returns raw
// candidates and the caller filters by `length === 1`.
function collectAnchorMatches(containers: AnchorContainer[], anchor: Anchor) {
  if (anchor.prefix && anchor.suffix) {
    return collectBetweenTextMatches(containers, anchor.prefix, anchor.suffix);
  }

  if (anchor.prefix) {
    return collectSingleTextMatches(containers, anchor.prefix, "after");
  }

  if (anchor.suffix) {
    return collectSingleTextMatches(containers, anchor.suffix, "before");
  }

  return [];
}

function collectSingleTextMatches(
  containers: AnchorContainer[],
  text: string,
  side: "after" | "before",
) {
  const matches: PresenceMatch[] = [];

  for (const container of containers) {
    for (const startOffset of findOccurrences(container.text, text)) {
      matches.push({
        container,
        offset: side === "after" ? startOffset + text.length : startOffset,
      });
    }
  }

  return matches;
}

function collectBetweenTextMatches(containers: AnchorContainer[], prefix: string, suffix: string) {
  const matches: PresenceMatch[] = [];

  for (const container of containers) {
    for (const range of findContextRanges(container.text, prefix, suffix)) {
      matches.push({ container, offset: range.startOffset });
    }
  }

  return matches;
}
