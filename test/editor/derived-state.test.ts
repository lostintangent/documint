import { expect, test } from "bun:test";
import {
  createCommentAnchorFromContainer,
  createCommentQuoteFromContainer,
  createCommentThread,
  listCommentTargetContainers,
} from "@/comments";
import { getCommentState } from "@/editor/comments";
import {
  getCanvasEditablePreviewState,
} from "@/editor/derived-state";
import { createEditorState, setCanvasSelection as setSelection } from "@/editor/model/state";
import { parseMarkdown } from "@/markdown";

test("derives active block and active span state from the canvas selection", () => {
  let state = createEditorState(
    parseMarkdown("Paragraph with **strong** text and [link](https://example.com).\n"),
  );
  const container = state.documentEditor.regions[0];

  if (!container) {
    throw new Error("Expected container");
  }

  state = setSelection(state, {
    regionId: container.id,
    offset: container.text.indexOf("strong") + 1,
  });

  const marked = getCanvasEditablePreviewState(state);

  expect(marked.activeBlock?.nodeType).toBe("paragraph");
  expect(marked.activeSpan.kind).toBe("marks");

  state = setSelection(state, {
    regionId: container.id,
    offset: container.text.indexOf("link") + 1,
  });

  const linked = getCanvasEditablePreviewState(state);

  expect(linked.activeSpan.kind).toBe("link");
  expect(linked.activeSpan.kind === "link" ? linked.activeSpan.url : null).toBe(
    "https://example.com",
  );
});

test("maps durable comment anchors to live canvas ranges", () => {
  const snapshot = parseMarkdown("Review surface anchors survive.\n");
  const container = listCommentTargetContainers(snapshot)[0];

  if (!container) {
    throw new Error("Expected review container");
  }

  const thread = createCommentThread({
    anchor: createCommentAnchorFromContainer(container, 7, 14),
    body: "Highlight anchors",
    createdAt: "2026-04-05T12:00:00.000Z",
    quote: createCommentQuoteFromContainer(container, 7, 14),
  });
  const state = createEditorState({
    ...snapshot,
    comments: [thread],
  });
  const commentState = getCommentState(state.documentEditor);

  expect(commentState.threads).toHaveLength(1);
  expect(commentState.liveRanges[0]?.threadIndex).toBe(0);
  expect(commentState.liveRanges[0]?.start).toBeGreaterThanOrEqual(0);
  expect(commentState.liveRanges[0]?.end).toBeGreaterThan(commentState.liveRanges[0]?.start ?? 0);
});
