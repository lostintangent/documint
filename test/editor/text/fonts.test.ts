import { expect, test } from "bun:test";
import { inlineTextHasCustomMetrics, resolveInlineTextStyle } from "@/editor/text/fonts";

test("resolves superscript as a scaled font with a raised baseline", () => {
  const style = resolveInlineTextStyle("16px ui-sans-serif, system-ui, sans-serif", [
    "superscript",
  ]);

  expect(style.font).toContain("11.5px");
  expect(style.baselineShift).toBeLessThan(0);
  expect(style.hasCustomMetrics).toBe(true);
});

test("does not apply superscript typography to code-marked text", () => {
  const style = resolveInlineTextStyle("16px ui-sans-serif, system-ui, sans-serif", [
    "code",
    "superscript",
  ]);

  expect(style.font).toContain("15px ui-monospace");
  expect(style.baselineShift).toBe(0);
  expect(inlineTextHasCustomMetrics(["code", "superscript"])).toBe(true);
});

test("treats decorative-only marks as normal text metrics", () => {
  expect(inlineTextHasCustomMetrics(["underline", "strikethrough"])).toBe(false);
});
