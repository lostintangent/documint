/**
 * Resolves host-provided AI presence cursor targets against the current editor
 * document. Presence is ephemeral overlay state, so this module owns semantic
 * text matching only and leaves geometric measurement to layout/paint.
 */
import { type Anchor, type AnchorContainer } from "@/document";
import type { Presence } from "@/types";
import type { DocumentIndex, EditorSelectionPoint } from "../state";
import { projectAnchorContainersToEditor } from "./index";

export type { Presence };

export type EditorPresenceViewport = {
  scrollTop: number | null;
  status: EditorPresenceViewportStatus;
};

export type EditorPresenceViewportStatus = "above" | "below" | "unresolved" | "visible";

export type EditorPresence = Presence & {
  cursorPoint: EditorSelectionPoint | null;
  viewport: EditorPresenceViewport | null;
};

type PresenceMatch = {
  container: AnchorContainer;
  offset: number;
};

export function resolvePresenceCursors(
  documentIndex: DocumentIndex,
  presence: Presence[],
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

function resolvePresenceCursorPoint(
  presence: Presence,
  semanticContainers: AnchorContainer[],
  containerProjection: ReturnType<typeof projectAnchorContainersToEditor>,
) {
  if (!presence.cursor) {
    return null;
  }

  const candidateContainers = filterAnchorContainers(semanticContainers, presence.cursor);
  const matches = collectPresenceAnchorMatches(candidateContainers, presence.cursor);

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

function collectPresenceAnchorMatches(containers: AnchorContainer[], anchor: Anchor) {
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
  if (text.length === 0) {
    return [];
  }

  const matches: PresenceMatch[] = [];

  for (const container of containers) {
    for (const startOffset of collectSubstringOffsets(container.text, text)) {
      matches.push({
        container,
        offset: side === "after" ? startOffset + text.length : startOffset,
      });
    }
  }

  return matches;
}

function collectBetweenTextMatches(containers: AnchorContainer[], prefix: string, suffix: string) {
  if (prefix.length === 0 || suffix.length === 0) {
    return [];
  }

  const matches: PresenceMatch[] = [];

  for (const container of containers) {
    for (const prefixIndex of collectSubstringOffsets(container.text, prefix)) {
      const offset = prefixIndex + prefix.length;
      const suffixIndex = container.text.indexOf(suffix, offset);

      if (suffixIndex !== -1) {
        matches.push({
          container,
          offset,
        });
      }
    }
  }

  return matches;
}

function collectSubstringOffsets(text: string, query: string) {
  const offsets: number[] = [];
  let searchIndex = 0;

  while (searchIndex <= text.length) {
    const matchIndex = text.indexOf(query, searchIndex);

    if (matchIndex === -1) {
      break;
    }

    offsets.push(matchIndex);
    searchIndex = matchIndex + Math.max(1, query.length);
  }

  return offsets;
}
