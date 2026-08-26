import { describe, expect, test } from "bun:test";
import { blendCanvasColors } from "@/renderer/effects/colors";

describe("Canvas color blending", () => {
  test("preserves numeric blending for existing theme colors", () => {
    expect(blendCanvasColors("#000000", "#ffffff", 0.5)).toBe("rgba(128, 128, 128, 1)");
  });

  test("uses native CSS mixing for OKLCH theme colors", () => {
    expect(blendCanvasColors("#c2185b", "oklch(0.556 0 0)", 0.5)).toBe(
      "color-mix(in srgb, #c2185b 50%, oklch(0.556 0 0) 50%)",
    );
  });
});
