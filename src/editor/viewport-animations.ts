import type { DocumentResourceRegistry } from "@/types";
import {
  hasActiveCommentHighlightsInViewport,
  type EditorCommentRange,
  type EditorPresence,
} from "./anchors";
import type { EditorLayoutState } from "./layout";
import { hasActiveResourcesInViewport } from "./resources";
import type { EditorState } from "./state";
import { hasAnimatedDecorationsInViewport, type TextDecorationIndex } from "./text/decorations";

export type ContentAnimationViewportInputs = {
  commentPresence: ReadonlyMap<number, EditorPresence>;
  commentRanges: readonly EditorCommentRange[];
  resourceRegistry: DocumentResourceRegistry;
  state: EditorState;
  textDecorations: TextDecorationIndex;
  viewport: EditorLayoutState;
};

export function hasContentAnimationsInViewport({
  commentPresence,
  commentRanges,
  resourceRegistry,
  state,
  textDecorations,
  viewport,
}: ContentAnimationViewportInputs): boolean {
  return (
    hasActiveResourcesInViewport(state, viewport, resourceRegistry) ||
    hasAnimatedDecorationsInViewport(state, viewport, textDecorations) ||
    hasActiveCommentHighlightsInViewport(viewport, commentRanges, commentPresence)
  );
}
