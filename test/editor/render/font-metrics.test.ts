import { expect, test } from "bun:test";
import {
  resolveCanvasCenteredTextBaseline,
  resolveCanvasCenteredTextTop,
  resolveCanvasFontMetrics,
  resolveCanvasFontSize,
} from "@/editor/render/font-metrics";

test("reads the font size from a canvas font declaration", () => {
  expect(resolveCanvasFontSize('700 16px "Iowan Old Style", serif')).toBe(16);
  expect(resolveCanvasFontSize('italic 15.5px ui-monospace, monospace')).toBe(15.5);
});

test("resolves stable canvas font metrics and centers them inside the line height", () => {
  expect(resolveCanvasFontMetrics('16px "Iowan Old Style", serif')).toEqual({
    ascent: 13,
    descent: 3,
    emHeight: 16,
  });
  expect(resolveCanvasCenteredTextTop(24, '16px "Iowan Old Style", serif')).toBe(4);
  expect(resolveCanvasCenteredTextBaseline(24, '16px "Iowan Old Style", serif')).toBe(17);
  expect(resolveCanvasCenteredTextTop(36, '700 32px "Iowan Old Style", serif')).toBe(2);
});

test("clamps tiny fonts so paint helpers keep a minimum readable box", () => {
  expect(resolveCanvasFontMetrics("10px serif")).toEqual({
    ascent: 10,
    descent: 2,
    emHeight: 12,
  });
  expect(resolveCanvasCenteredTextTop(24, "10px serif")).toBe(6);
});
