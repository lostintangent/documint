import { indexedTextEntries } from "@test/editor/helpers";
import { expect, test } from "bun:test";
import {
  createEditorLayoutState,
  createLayoutCache,
  createEditorState,
  hasActiveResourcesInViewport,
} from "@/editor";
import { parseDocument } from "@/markdown";
import type { DocumentResources } from "@/types";

test("detects active resources only when their line is visible", () => {
  const state = createEditorState(
    parseDocument("alpha\n\n[Recording](demo-resource://recording/live)\n\nomega\n", {
      resourceProtocols: ["demo-resource:"],
    }),
  );
  const resources: DocumentResources = {
    images: new Map(),
    resourceRegistry: {
      active: new Set(["demo-resource://recording/live"]),
      protocols: new Map([["demo-resource:", { icon: "R", label: "Demo resource" }]]),
    },
  };
  const layoutCache = createLayoutCache();
  const viewport = createEditorLayoutState(
    state,
    { height: 400, top: 0, width: 320 },
    layoutCache,
    resources,
  );
  const resourcePath = indexedTextEntries(state).find((path) =>
    (path.inlines ?? []).some((inline) => inline.node.type === "resource"),
  );

  if (!resourcePath) {
    throw new Error("Expected resource path");
  }

  const resourceLine = viewport.layout.lines.find((line) => line.path === resourcePath.path);

  if (!resourceLine) {
    throw new Error("Expected resource line");
  }

  const beforeResourceViewport = {
    ...viewport,
    paintTop: 0,
    viewport: { ...viewport.viewport, height: Math.max(1, resourceLine.top - 1), top: 0 },
  };
  const resourceViewport = {
    ...viewport,
    paintTop: resourceLine.top,
    viewport: {
      ...viewport.viewport,
      height: resourceLine.height,
      top: resourceLine.top,
    },
  };

  expect(
    hasActiveResourcesInViewport(state, beforeResourceViewport, resources.resourceRegistry),
  ).toBe(false);
  expect(hasActiveResourcesInViewport(state, resourceViewport, resources.resourceRegistry)).toBe(
    true,
  );
  expect(
    hasActiveResourcesInViewport(state, resourceViewport, {
      ...resources.resourceRegistry,
      active: new Set(["demo-resource://note/complete"]),
    }),
  ).toBe(false);
});
