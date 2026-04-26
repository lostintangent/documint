import { expect, test } from "bun:test";
import { createCanvasRenderCache, prepareViewport, resolvePresenceViewport } from "@/editor";
import {
  resolvePresenceCursors,
  type EditorPresence,
  type EditorPresenceViewport,
} from "@/editor/anchors";
import { createEditorState } from "@/editor/state";
import type { EditorRegion } from "@/editor/state";
import { parseMarkdown } from "@/markdown";

function scrollTopOf(viewport: EditorPresenceViewport | null | undefined) {
  if (!viewport || viewport.status === "unresolved") return null;
  return viewport.scrollTop;
}

test("resolves unique prefix-only and suffix-only presence cursors", () => {
  const state = createEditorState(
    parseMarkdown(`# Sample

Markdown is the persistence boundary.

Only the active region reveals source-like editing affordances.
`),
  );
  const [afterCursor, beforeCursor] = resolvePresenceCursors(state.documentIndex, [
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
  const state = createEditorState(
    parseMarkdown(`alpha beta gamma

alpha beta delta
`),
  );
  const [cursor] = resolvePresenceCursors(state.documentIndex, [
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
  const state = createEditorState(parseMarkdown("alpha beta\n"));
  const [exactCursor, trimmedCursor] = resolvePresenceCursors(state.documentIndex, [
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

test("leaves ambiguous or missing targets unresolved", () => {
  const state = createEditorState(
    parseMarkdown(`repeat

repeat
`),
  );
  const [ambiguousCursor, missingCursor] = resolvePresenceCursors(state.documentIndex, [
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
  const renderCache = createCanvasRenderCache();
  const state = createEditorState(parseMarkdown(createPresenceViewportFixture()));
  const firstRegion = requireRegion(state.documentIndex.regions[0]);
  const lastRegion = requireRegion(state.documentIndex.regions.at(-1));
  const topViewport = prepareViewport(
    state,
    {
      height: 120,
      top: 0,
      width: 420,
    },
    renderCache,
  );
  const [visiblePresence, belowPresence] = resolvePresenceViewport(state, topViewport, [
    createResolvedCursor("visible", firstRegion),
    createResolvedCursor("below", lastRegion),
  ]);

  expect(visiblePresence?.viewport?.status).toBe("visible");
  expect(belowPresence?.viewport?.status).toBe("below");
  expect(scrollTopOf(belowPresence?.viewport)).toBeGreaterThan(0);

  const lowerViewport = prepareViewport(
    state,
    {
      height: 120,
      top: Math.max(120, topViewport.totalHeight - 180),
      width: 420,
    },
    renderCache,
  );
  const [abovePresence] = resolvePresenceViewport(state, lowerViewport, [
    createResolvedCursor("above", firstRegion),
  ]);

  expect(abovePresence?.viewport?.status).toBe("above");
  expect(scrollTopOf(abovePresence?.viewport)).toBe(0);
});

test("keeps unresolved presence visible without a scroll target", () => {
  const renderCache = createCanvasRenderCache();
  const state = createEditorState(parseMarkdown(createPresenceViewportFixture()));
  const viewport = prepareViewport(
    state,
    {
      height: 120,
      top: 0,
      width: 420,
    },
    renderCache,
  );

  expect(
    resolvePresenceViewport(state, viewport, [
      {
        cursorPoint: null,
        id: "unresolved",
        username: "Unresolved",
        viewport: null,
      },
    ]),
  ).toEqual([
    {
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

function createResolvedCursor(username: string, region: EditorRegion): EditorPresence {
  return {
    cursorPoint: {
      offset: 0,
      regionId: region.id,
    },
    id: username,
    username,
    viewport: null,
  };
}

function requireRegion(region: EditorRegion | undefined) {
  if (!region) {
    throw new Error("Expected editor region");
  }

  return region;
}
