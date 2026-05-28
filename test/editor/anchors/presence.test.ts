import { expect, test } from "bun:test";
import {
  createLayoutCache,
  createEditorState,
  createEditorLayoutState,
  resolvePresenceViewport,
} from "@/editor";
import {
  createAnchorFromContainer,
  createCommentThread,
  createDocument,
  createParagraphTextBlock,
  extractQuoteFromContainer,
  listAnchorContainers,
} from "@/document";
import {
  getCommentState,
  resolvePresenceTargets,
  type EditorPresence,
  type EditorPresenceViewport,
} from "@/editor/anchors";
import type { EditableRegion } from "@/editor/state";
import { setup } from "../helpers";

function scrollTopOf(viewport: EditorPresenceViewport | null | undefined) {
  if (!viewport || viewport.status === "unresolved") return null;
  return viewport.scrollTop;
}

test("resolves unique prefix-only and suffix-only presence cursors", () => {
  const state = setup(`# Sample

Markdown is the persistence boundary.

Only the active region reveals source-like editing affordances.
`);
  const [afterCursor, beforeCursor] = resolvePresenceTargets(state.documentIndex, [
    {
      cursor: {
        prefix: "Markdown is the persistence boundary.",
      },
      id: "user",
      username: "User",
    },
    {
      cursor: {
        suffix: "Only the active region reveals source-like editing affordances.",
      },
      id: "agent",
      username: "Agent",
    },
  ]);

  expect(afterCursor?.cursorPoint).not.toBeNull();
  expect(beforeCursor?.cursorPoint).not.toBeNull();

  const afterRegion = afterCursor?.cursorPoint
    ? state.documentIndex.regionIndex.get(afterCursor.cursorPoint.regionId)
    : null;
  const beforeRegion = beforeCursor?.cursorPoint
    ? state.documentIndex.regionIndex.get(beforeCursor.cursorPoint.regionId)
    : null;

  expect(afterRegion?.text.slice(0, afterCursor?.cursorPoint?.offset)).toBe(
    "Markdown is the persistence boundary.",
  );
  expect(beforeRegion?.text.slice(beforeCursor?.cursorPoint?.offset ?? 0)).toBe(
    "Only the active region reveals source-like editing affordances.",
  );
});

test("uses prefix and suffix together to disambiguate repeated text", () => {
  const state = setup(`alpha beta gamma

alpha beta delta
`);
  const [cursor] = resolvePresenceTargets(state.documentIndex, [
    {
      cursor: {
        prefix: "alpha beta",
        suffix: "delta",
      },
      id: "agent",
      username: "Agent",
    },
  ]);

  expect(cursor?.cursorPoint).not.toBeNull();

  const region = cursor?.cursorPoint
    ? state.documentIndex.regionIndex.get(cursor.cursorPoint.regionId)
    : null;

  expect(region?.text).toBe("alpha beta delta");
  expect(region?.text.slice(0, cursor?.cursorPoint?.offset)).toBe("alpha beta");
});

test("preserves exact presence anchor text when matching", () => {
  const state = setup("alpha beta\n");
  const [exactCursor, trimmedCursor] = resolvePresenceTargets(state.documentIndex, [
    {
      cursor: {
        prefix: "alpha ",
      },
      id: "user",
      username: "User",
    },
    {
      cursor: {
        prefix: " alpha ",
      },
      id: "agent",
      username: "Agent",
    },
  ]);

  expect(exactCursor?.cursorPoint?.offset).toBe("alpha ".length);
  expect(trimmedCursor?.cursorPoint).toBeNull();
});

test("resolves comment thread anchors as active threads without projecting a cursor", () => {
  const block = createParagraphTextBlock("alpha comment target");
  const baseDocument = createDocument([block]);
  const container = listAnchorContainers(baseDocument)[0];

  if (!container) {
    throw new Error("Expected anchor container");
  }

  const thread = createCommentThread({
    anchor: createAnchorFromContainer(container, 6, "alpha comment".length),
    body: "Working here",
    createdAt: "2026-04-05T12:00:00.000Z",
    quote: "comment",
  });
  const state = createEditorState(createDocument([block], [thread]));
  const [presence] = resolvePresenceTargets(state.documentIndex, [
    {
      cursor: { threadId: thread.id },
      id: "agent",
      username: "Agent",
    },
  ]);

  expect(presence?.commentThreadIndex).toBe(0);
  expect(presence?.cursorPoint).toBeNull();
});

test("leaves missing comment thread anchors unresolved", () => {
  const block = createParagraphTextBlock("comment target suffix");
  const state = createEditorState(createDocument([block]));
  const [presence] = resolvePresenceTargets(state.documentIndex, [
    {
      cursor: { threadId: "missing-thread" },
      id: "agent",
      username: "Agent",
    },
  ]);

  expect(presence?.commentThreadIndex).toBeNull();
  expect(presence?.cursorPoint).toBeNull();
});

test("leaves ambiguous or missing targets unresolved", () => {
  const state = setup(`repeat

repeat
`);
  const [ambiguousCursor, missingCursor] = resolvePresenceTargets(state.documentIndex, [
    {
      cursor: {
        prefix: "repeat",
      },
      id: "user",
      username: "User",
    },
    {
      cursor: {
        suffix: "absent",
      },
      id: "agent",
      username: "Agent",
    },
  ]);

  expect(ambiguousCursor?.cursorPoint).toBeNull();
  expect(missingCursor?.cursorPoint).toBeNull();
});

test("resolves presence viewport state", () => {
  const layoutCache = createLayoutCache();
  const state = setup(createPresenceViewportFixture());
  const firstRegion = requireRegion(state.documentIndex.regions[0]);
  const lastRegion = requireRegion(state.documentIndex.regions.at(-1));
  const topViewport = createEditorLayoutState(
    state,
    {
      height: 120,
      top: 0,
      width: 420,
    },
    layoutCache,
  );
  const [visiblePresence, belowPresence] = resolvePresenceViewport(
    state,
    topViewport,
    [createResolvedCursor("visible", firstRegion), createResolvedCursor("below", lastRegion)],
    [],
  );

  expect(visiblePresence?.viewport?.status).toBe("visible");
  expect(belowPresence?.viewport?.status).toBe("below");
  expect(scrollTopOf(belowPresence?.viewport)).toBeGreaterThan(0);

  const lowerViewport = createEditorLayoutState(
    state,
    {
      height: 120,
      top: Math.max(120, topViewport.totalHeight - 180),
      width: 420,
    },
    layoutCache,
  );
  const [abovePresence] = resolvePresenceViewport(
    state,
    lowerViewport,
    [createResolvedCursor("above", firstRegion)],
    [],
  );

  expect(abovePresence?.viewport?.status).toBe("above");
  expect(scrollTopOf(abovePresence?.viewport)).toBe(0);
});

test("resolves comment thread presence viewport state", () => {
  const layoutCache = createLayoutCache();
  const blocks = Array.from({ length: 24 }, (_, index) => {
    return createParagraphTextBlock(`Presence viewport comment paragraph ${index}.`);
  });
  const baseDocument = createDocument(blocks);
  const containers = listAnchorContainers(baseDocument);
  const firstContainer = containers[0];
  const lastContainer = containers.at(-1);

  if (!firstContainer || !lastContainer) {
    throw new Error("Expected comment anchor containers");
  }

  const firstThread = createCommentThread({
    anchor: createAnchorFromContainer(
      firstContainer,
      firstContainer.text.indexOf("paragraph"),
      firstContainer.text.length - 1,
    ),
    body: "Working here",
    createdAt: "2026-04-05T12:00:00.000Z",
    quote: extractQuoteFromContainer(
      firstContainer,
      firstContainer.text.indexOf("paragraph"),
      firstContainer.text.length - 1,
    ),
  });
  const lastThread = createCommentThread({
    anchor: createAnchorFromContainer(
      lastContainer,
      lastContainer.text.indexOf("paragraph"),
      lastContainer.text.length - 1,
    ),
    body: "Working there",
    createdAt: "2026-04-05T12:00:00.000Z",
    quote: extractQuoteFromContainer(
      lastContainer,
      lastContainer.text.indexOf("paragraph"),
      lastContainer.text.length - 1,
    ),
  });
  const state = createEditorState(createDocument(blocks, [firstThread, lastThread]));
  const commentRanges = getCommentState(state).ranges;
  const topViewport = createEditorLayoutState(
    state,
    {
      height: 120,
      top: 0,
      width: 420,
    },
    layoutCache,
  );
  const [visiblePresence, belowPresence] = resolvePresenceViewport(
    state,
    topViewport,
    resolvePresenceTargets(state.documentIndex, [
      {
        cursor: { threadId: firstThread.id },
        id: "visible",
        username: "Visible",
      },
      {
        cursor: { threadId: lastThread.id },
        id: "below",
        username: "Below",
      },
    ]),
    commentRanges,
  );

  expect(visiblePresence?.viewport?.status).toBe("visible");
  expect(belowPresence?.viewport?.status).toBe("below");
  expect(scrollTopOf(belowPresence?.viewport)).toBeGreaterThan(0);

  const lowerViewport = createEditorLayoutState(
    state,
    {
      height: 120,
      top: Math.max(120, topViewport.totalHeight - 180),
      width: 420,
    },
    layoutCache,
  );
  const [abovePresence] = resolvePresenceViewport(
    state,
    lowerViewport,
    resolvePresenceTargets(state.documentIndex, [
      {
        cursor: { threadId: firstThread.id },
        id: "above",
        username: "Above",
      },
    ]),
    commentRanges,
  );

  expect(abovePresence?.viewport?.status).toBe("above");
  expect(scrollTopOf(abovePresence?.viewport)).toBe(0);
});

test("keeps unresolved presence visible without a scroll target", () => {
  const layoutCache = createLayoutCache();
  const state = setup(createPresenceViewportFixture());
  const viewport = createEditorLayoutState(
    state,
    {
      height: 120,
      top: 0,
      width: 420,
    },
    layoutCache,
  );

  expect(
    resolvePresenceViewport(
      state,
      viewport,
      [
        {
          commentThreadIndex: null,
          cursorPoint: null,
          id: "unresolved",
          username: "Unresolved",
          viewport: null,
        },
      ],
      [],
    ),
  ).toEqual([
    {
      commentThreadIndex: null,
      cursorPoint: null,
      id: "unresolved",
      username: "Unresolved",
      viewport: {
        status: "unresolved",
      },
    },
  ]);
});

function createPresenceViewportFixture() {
  return (
    Array.from({ length: 24 }, (_, index) => `Presence viewport paragraph ${index}.`).join("\n\n") +
    "\n"
  );
}

function createResolvedCursor(username: string, region: EditableRegion): EditorPresence {
  return {
    commentThreadIndex: null,
    cursorPoint: {
      offset: 0,
      regionId: region.id,
    },
    id: username,
    username,
    viewport: null,
  };
}

function requireRegion(region: EditableRegion | undefined) {
  if (!region) {
    throw new Error("Expected editor region");
  }

  return region;
}
