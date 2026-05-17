import { expect, test } from "bun:test";
import {
  resolveCenteredTextBaseline,
  resolveCenteredTextTop,
  resolveFontMetrics,
  resolveFontSize,
} from "@/editor/text/measure";

test("reads the font size from a font declaration", () => {
  expect(resolveFontSize('700 16px "Iowan Old Style", serif')).toBe(16);
  expect(resolveFontSize("italic 15.5px ui-monospace, monospace")).toBe(15.5);
});

test("resolves stable font metrics and centers them inside the line height", () => {
  expect(resolveFontMetrics('16px "Iowan Old Style", serif')).toEqual({
    ascent: 13,
    descent: 3,
    emHeight: 16,
  });
  expect(resolveCenteredTextTop(24, '16px "Iowan Old Style", serif')).toBe(4);
  expect(resolveCenteredTextBaseline(24, '16px "Iowan Old Style", serif')).toBe(17);
  expect(resolveCenteredTextTop(36, '700 32px "Iowan Old Style", serif')).toBe(2);
});

test("clamps tiny fonts so callers keep a minimum readable box", () => {
  expect(resolveFontMetrics("10px serif")).toEqual({
    ascent: 10,
    descent: 2,
    emHeight: 12,
  });
  expect(resolveCenteredTextTop(24, "10px serif")).toBe(6);
});
