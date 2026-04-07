import { expect, test } from "bun:test";
import { resolvePointerPointInScrollContainer } from "@/component/lib/pointer";

test("resolves document-space points from the scroll container", () => {
  const point = resolvePointerPointInScrollContainer(
    {
      clientX: 44,
      clientY: 82,
    },
    {
      getBoundingClientRect: () =>
        ({
          bottom: 340,
          height: 300,
          left: 12,
          right: 412,
          top: 32,
          width: 400,
          x: 12,
          y: 32,
        }) as DOMRect,
      scrollLeft: 8,
      scrollTop: 120,
    },
  );

  expect(point).toEqual({
    x: 40,
    y: 170,
  });
});
