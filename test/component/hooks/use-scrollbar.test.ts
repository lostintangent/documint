import { describe, expect, test } from "bun:test";
import {
  resolveScrollbarDragScrollTop,
  resolveScrollbarGeometry,
} from "@/component/hooks/useScrollbar";

describe("scrollbar geometry", () => {
  test("maps the native scroll range onto a bounded thumb", () => {
    expect(resolveScrollbarGeometry(0, 180, 180)).toBeNull();

    const top = resolveScrollbarGeometry(0, 400, 100)!;
    const middle = resolveScrollbarGeometry(150, 400, 100)!;
    const bottom = resolveScrollbarGeometry(300, 400, 100)!;

    expect(top.top).toBe(1);
    expect(top.top).toBeLessThan(middle.top);
    expect(middle.top).toBeLessThan(bottom.top);
    expect(bottom.top + bottom.height).toBe(99);
    expect(resolveScrollbarGeometry(-100, 10_000, 100)!.top).toBe(1);
    expect(resolveScrollbarGeometry(20_000, 10_000, 100)).toEqual({
      height: 16,
      top: 83,
    });
  });
});

describe("scrollbar dragging", () => {
  test("maps thumb movement onto the native scroll range", () => {
    expect(resolveScrollbarDragScrollTop(0, 73.5, 400, 100)).toBe(300);
    expect(resolveScrollbarDragScrollTop(150, -36.75, 400, 100)).toBe(0);
    expect(resolveScrollbarDragScrollTop(150, 36.75, 400, 100)).toBe(300);
  });

  test("clamps movement at both document boundaries", () => {
    expect(resolveScrollbarDragScrollTop(50, -1_000, 10_000, 100)).toBe(0);
    expect(resolveScrollbarDragScrollTop(50, 1_000, 10_000, 100)).toBe(9_900);
    expect(resolveScrollbarDragScrollTop(0, 10, 100, 100)).toBe(0);
  });
});
