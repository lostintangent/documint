import { listAnchorContainers, type AnchorContainer } from "@/document";
import { createSemanticRegionIndex, type DocumentIndex, type EditableRegion } from "../state";

type SemanticContainerProjection = {
  runtimeContainer: EditableRegion | null;
  semanticContainer: AnchorContainer;
};

export function projectAnchorContainersToEditor(documentIndex: DocumentIndex) {
  const semanticContainers = listAnchorContainers(documentIndex.document);
  const semanticContainersById = new Map(
    semanticContainers.map((container) => [container.id, container]),
  );
  const runtimeContainersBySemanticId = createSemanticRegionIndex(documentIndex);

  return {
    findBySemanticMatch(containerId: string, containerOrdinal: number) {
      const semanticContainer =
        semanticContainersById.get(containerId) ?? semanticContainers[containerOrdinal] ?? null;

      if (!semanticContainer) {
        return null;
      }

      return {
        runtimeContainer: runtimeContainersBySemanticId.get(semanticContainer.id) ?? null,
        semanticContainer,
      } satisfies SemanticContainerProjection;
    },
    list(containerKind?: AnchorContainer["containerKind"]) {
      return containerKind
        ? semanticContainers.filter((container) => container.containerKind === containerKind)
        : semanticContainers;
    },
    resolveRuntimeContainer(containerId: string) {
      return runtimeContainersBySemanticId.get(containerId) ?? null;
    },
  };
}

export {
  createCommentThreadForSelection,
  getCommentState,
  hasActiveCommentHighlightsInViewport,
  resolveActiveCommentIndex,
  resolveCommentThreadViewportPosition,
  updateCommentThreadsForRegionEdit,
  type EditorCommentRange,
  type EditorCommentState,
} from "./comments";

export {
  resolvePresenceTargets,
  type EditorPresence,
  type EditorPresenceViewport,
  type EditorPresenceViewportStatus,
} from "./presence";

export { resolveCursorViewportStatus, resolvePresenceViewport } from "./presence/viewport";
