import { expect, test } from "bun:test";
import {
  createLayoutCache,
  hasAnimatedDecorations,
  hasAnimatedDecorationsInViewport,
  createEditorLayoutState,
} from "@/editor";
import { getRegion, setup } from "../helpers";

test("detects animated text decorations", () => {
  expect(hasAnimatedDecorations(new Map())).toBe(false);
  expect(
    hasAnimatedDecorations(
      new Map([
        [
          "root.0.children",
          [
            {
              backgroundColor: "gold",
              endOffset: 4,
              path: "root.0.children",
              startOffset: 0,
            },
          ],
        ],
      ]),
    ),
  ).toBe(false);
  expect(
    hasAnimatedDecorations(
      new Map([
        [
          "root.0.children",
          [
            {
              backgroundColor: "gold",
              pulse: true,
              endOffset: 4,
              path: "root.0.children",
              startOffset: 0,
            },
          ],
        ],
      ]),
    ),
  ).toBe(true);
});

test("detects animated text decorations in the visible viewport", () => {
  const state = setup("alpha\n\nbeta\n\nsparkle\n\nomega\n");
  const region = getRegion(state, "sparkle");
  const layoutCache = createLayoutCache();
  const viewport = createEditorLayoutState(state, { height: 400, top: 0, width: 320 }, layoutCache);
  const targetLine = viewport.layout.lines.find((line) => line.regionId === region.id);

  if (!targetLine) {
    throw new Error("Expected line for decorated region");
  }

  const textDecorations = new Map([
    [
      region.path,
      [
        {
          backgroundColor: "gold",
          color: "gold",
          endOffset: region.text.length,
          path: region.path,
          pulse: true,
          startOffset: 0,
        },
      ],
    ],
  ]);
  const beforeTargetViewport = {
    ...viewport,
    paintTop: 0,
    viewport: { ...viewport.viewport, height: Math.max(1, targetLine.top - 1), top: 0 },
  };
  const targetViewport = {
    ...viewport,
    paintTop: targetLine.top,
    viewport: {
      ...viewport.viewport,
      height: targetLine.height,
      top: targetLine.top,
    },
  };

  expect(hasAnimatedDecorationsInViewport(state, beforeTargetViewport, textDecorations)).toBe(
    false,
  );
  expect(hasAnimatedDecorationsInViewport(state, targetViewport, textDecorations)).toBe(true);

  const scrolledViewport = createEditorLayoutState(
    state,
    { height: targetLine.height, top: targetLine.top, width: 320 },
    layoutCache,
  );

  expect(hasAnimatedDecorationsInViewport(state, scrolledViewport, textDecorations)).toBe(true);
});
