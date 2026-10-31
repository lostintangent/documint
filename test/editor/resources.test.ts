import { expect, test } from "bun:test";
import { createEditorLayoutState, createLayoutCache, hasActiveResourcesInViewport } from "@/editor";
import { createResources, getPath, setup } from "./helpers";

test("detects active resources only when their line is visible", () => {
  const state = setup("alpha\n\n[Recording](demo-resource://recording/live)\n\nomega\n", {
    resourceProtocols: ["demo-resource:"],
  });
  const resources = createResources({ active: ["demo-resource://recording/live"] });
  const layoutCache = createLayoutCache();
  const viewport = createEditorLayoutState(
    state,
    { height: 400, top: 0, width: 320 },
    layoutCache,
    resources,
  );
  const resourcePath = getPath(state, "￼");
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
