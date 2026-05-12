import { expect, test } from "bun:test";
import { resolveHorizontalSwipeDirection } from "@/component/hooks/usePointer";

test("resolves a right horizontal swipe", () => {
  expect(
    resolveHorizontalSwipeDirection({ x: 10, y: 20, time: 100 }, { x: 72, y: 24, time: 220 }),
  ).toBe("right");
});

test("resolves a left horizontal swipe", () => {
  expect(
    resolveHorizontalSwipeDirection({ x: 92, y: 20, time: 100 }, { x: 28, y: 18, time: 220 }),
  ).toBe("left");
});

test("ignores short horizontal movement", () => {
  expect(
    resolveHorizontalSwipeDirection({ x: 10, y: 20, time: 100 }, { x: 42, y: 20, time: 220 }),
  ).toBeNull();
});

test("ignores vertical scrolling movement", () => {
  expect(
    resolveHorizontalSwipeDirection({ x: 10, y: 20, time: 100 }, { x: 70, y: 84, time: 220 }),
  ).toBeNull();
});

test("ignores diagonal movement without clear horizontal intent", () => {
  expect(
    resolveHorizontalSwipeDirection({ x: 10, y: 20, time: 100 }, { x: 70, y: 58, time: 220 }),
  ).toBeNull();
});

test("ignores slow horizontal movement", () => {
  expect(
    resolveHorizontalSwipeDirection({ x: 10, y: 20, time: 100 }, { x: 72, y: 24, time: 820 }),
  ).toBeNull();
});
