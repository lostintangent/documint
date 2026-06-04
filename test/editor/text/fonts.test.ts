import { expect, test } from "bun:test";
import { inlineTextHasCustomMetrics, resolveInlineTextStyle } from "@/editor/text/fonts";

test("resolves superscript as a scaled font with a raised baseline", () => {
  const style = resolveInlineTextStyle(
    { baseFontSize: 16, font: "16px ui-sans-serif, system-ui, sans-serif" },
    ["superscript"],
  );

  expect(style.font).toContain("11.5px");
  expect(style.baselineShift).toBeLessThan(0);
  expect(style.hasCustomMetrics).toBe(true);
});

test("does not apply superscript typography to code-marked text", () => {
  const style = resolveInlineTextStyle(
    { baseFontSize: 16, font: "16px ui-sans-serif, system-ui, sans-serif" },
    ["code", "superscript"],
  );

  expect(style.font).toContain("15px ui-monospace");
  expect(style.baselineShift).toBe(0);
  expect(inlineTextHasCustomMetrics(["code", "superscript"])).toBe(true);
});

test("scales inline code font with the document base font size", () => {
  const styleAtBase14 = resolveInlineTextStyle(
    { baseFontSize: 14, font: "14px ui-sans-serif, system-ui, sans-serif" },
    ["code"],
  );
  const styleAtBase18 = resolveInlineTextStyle(
    { baseFontSize: 18, font: "18px ui-sans-serif, system-ui, sans-serif" },
    ["code"],
  );

  expect(styleAtBase14.font).toContain("13px ui-monospace");
  expect(styleAtBase18.font).toContain("17px ui-monospace");
});

test("treats decorative-only marks as normal text metrics", () => {
  expect(inlineTextHasCustomMetrics(["underline", "strikethrough"])).toBe(false);
});
