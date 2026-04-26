import { listAnchorContainers, type AnchorContainer } from "@/document";
import type { DocumentIndex, EditorRegion } from "../state";

type SemanticContainerProjection = {
  runtimeContainer: EditorRegion | null;
  semanticContainer: AnchorContainer;
};

export function projectAnchorContainersToEditor(documentIndex: DocumentIndex) {
  const semanticContainers = listAnchorContainers(documentIndex.document);
  const semanticContainersById = new Map(
    semanticContainers.map((container) => [container.id, container]),
  );
  const runtimeContainersBySemanticId = new Map(
    documentIndex.regions.map((region) => [region.semanticRegionId, region]),
  );

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
  updateCommentThreadsForRegionEdit,
  type EditorCommentRange,
  type EditorCommentState,
} from "./comments";

export {
  resolvePresenceCursors,
  type EditorPresence,
  type EditorPresenceViewport,
  type EditorPresenceViewportStatus,
} from "./presence";

export { resolvePresenceViewport } from "./presence-viewport";
