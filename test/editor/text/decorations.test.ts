import { describe, expect, test } from "bun:test";
import {
  createLayoutCache,
  hasAnimatedDecorationsInViewport,
  createEditorLayoutState,
  remapTextDecorationIndex,
  type TextDecoration,
} from "@/editor";
import type { TextDeletedEffect, TextInsertedEffect } from "@/editor/state";
import { getPath, setup } from "../helpers";

test("detects animated text decorations in the visible viewport", () => {
  const state = setup("alpha\n\nbeta\n\nsparkle\n\nomega\n");
  const path = getPath(state, "sparkle");
  const layoutCache = createLayoutCache();
  const viewport = createEditorLayoutState(state, { height: 400, top: 0, width: 320 }, layoutCache);
  const targetLine = viewport.layout.lines.find((line) => line.path === path.path);

  if (!targetLine) {
    throw new Error("Expected line for decorated path");
  }

  const textDecorations = new Map([
    [
      path.path,
      [
        {
          backgroundColor: "gold",
          color: "gold",
          endOffset: path.text.length,
          path: path.path,
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

  expect(hasAnimatedDecorationsInViewport(beforeTargetViewport, textDecorations)).toBe(false);
  expect(hasAnimatedDecorationsInViewport(targetViewport, textDecorations)).toBe(true);

  const scrolledViewport = createEditorLayoutState(
    state,
    { height: targetLine.height, top: targetLine.top, width: 320 },
    layoutCache,
  );

  expect(hasAnimatedDecorationsInViewport(scrolledViewport, textDecorations)).toBe(true);
});

describe("decoration edit remapping", () => {
  test("shifts ranges after an insertion and drops the range it lands inside", () => {
    const ranges = [
      { color: "gray", endOffset: 2, path: "root.0", startOffset: 0 },
      { color: "blue", endOffset: 7, path: "root.0", startOffset: 3 },
      { color: "green", endOffset: 12, path: "root.0", startOffset: 9 },
    ];
    const next = remapTextDecorationIndex(new Map([["root.0", ranges]]), typed(5, "ab"));

    expect(next?.get("root.0")).toEqual([
      ranges[0]!,
      { color: "green", endOffset: 14, path: "root.0", startOffset: 11 },
    ]);
    expect(next?.get("root.0")?.[0]).toBe(ranges[0]!);
  });

  test("shifts ranges after a deletion and preserves surviving range fragments", () => {
    const ranges = [
      { color: "gray", endOffset: 2, path: "root.0", startOffset: 0 },
      { color: "blue", endOffset: 8, path: "root.0", startOffset: 4 },
      { color: "green", endOffset: 14, path: "root.0", startOffset: 10 },
    ];

    expect(remapTextDecorationIndex(new Map([["root.0", ranges]]), deleted(5, "abc"))).toEqual(
      new Map([
        [
          "root.0",
          [
            ranges[0]!,
            { color: "blue", endOffset: 5, path: "root.0", startOffset: 4 },
            { color: "green", endOffset: 11, path: "root.0", startOffset: 7 },
          ],
        ],
      ]),
    );
  });

  test("remaps decoration fragments that span both sides of a deletion", () => {
    const ranges = [
      { color: "string", endOffset: 12, path: "root.0", startOffset: 3 },
      { color: "comment", endOffset: 10, path: "root.0", startOffset: 6 },
      { color: "keyword", endOffset: 8, path: "root.0", startOffset: 5 },
    ];

    expect(remapTextDecorationIndex(new Map([["root.0", ranges]]), deleted(5, "abc"))).toEqual(
      new Map([
        [
          "root.0",
          [
            { color: "string", endOffset: 9, path: "root.0", startOffset: 3 },
            { color: "comment", endOffset: 7, path: "root.0", startOffset: 5 },
          ],
        ],
      ]),
    );
  });

  test("patches only the edited path in the decoration index", () => {
    const untouched = [{ color: "red", endOffset: 4, path: "root.1", startOffset: 0 }];
    const previous = new Map([
      ["root.0", [{ color: "blue", endOffset: 6, path: "root.0", startOffset: 3 }]],
      ["root.1", untouched],
    ]);
    const next = remapTextDecorationIndex(previous, typed(0, "ab"));

    expect(next).toEqual(
      new Map([
        ["root.0", [{ color: "blue", endOffset: 8, path: "root.0", startOffset: 5 }]],
        ["root.1", untouched],
      ]),
    );
    expect(next?.get("root.1")).toBe(untouched);
  });

  test("does not color text inserted at a range's edge before the worker resolves it", () => {
    const ranges = [
      { color: "keyword", endOffset: 5, path: "root.0", startOffset: 0 },
      { color: "string", endOffset: 12, path: "root.0", startOffset: 8 },
    ];

    expect(remapTextDecorationIndex(new Map([["root.0", ranges]]), typed(5, "abc"))).toEqual(
      new Map([
        [
          "root.0",
          [
            { color: "keyword", endOffset: 5, path: "root.0", startOffset: 0 },
            { color: "string", endOffset: 15, path: "root.0", startOffset: 11 },
          ],
        ],
      ]),
    );
  });

  test("removes a path whose only range the deletion empties", () => {
    const previous = new Map([
      ["root.0", [{ color: "blue", endOffset: 6, path: "root.0", startOffset: 3 }]],
    ]);

    expect(remapTextDecorationIndex(previous, deleted(3, "abc"))).toEqual(new Map());
  });

  test("returns null when the edit leaves the path's ranges in place", () => {
    const previous = new Map<string, readonly TextDecoration[]>([
      ["root.0", [{ color: "blue", endOffset: 6, path: "root.0", startOffset: 3 }]],
    ]);

    expect(remapTextDecorationIndex(previous, typed(6, "ab"))).toBeNull();
    expect(remapTextDecorationIndex(previous, typed(0, "ab", "root.1"))).toBeNull();
  });
});

function typed(startOffset: number, text: string, path = "root.0"): TextInsertedEffect {
  return {
    contentKind: "source",
    endOffset: startOffset + text.length,
    kind: "text-inserted",
    path,
    startOffset,
    text,
  };
}

function deleted(startOffset: number, text: string, path = "root.0"): TextDeletedEffect {
  return {
    contentKind: "source",
    direction: "backward",
    kind: "text-deleted",
    path,
    placement: "line-middle",
    startOffset,
    text,
    textKind: "plain",
  };
}
