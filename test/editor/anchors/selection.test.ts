import { describe, expect, test } from "bun:test";
import {
  createSelectionAnchor,
  hasSelectionAnchorTextContinuity,
  resolveSelectionAnchor,
} from "@/editor/anchors";

describe("Selection anchors", () => {
  test("recovers a cursor when text is inserted before it", () => {
    const anchor = createSelectionAnchor("target", 0, "neutral");

    expect(resolveSelectionAnchor("intro target", anchor)).toEqual({
      matched: true,
      offset: "intro ".length,
    });
  });

  test("uses affinity when prefix and suffix point to different offsets", () => {
    const previousText = "alpha beta";
    const nextText = "alpha inserted beta";
    const previousOffset = "alpha ".length;
    const afterPrefix = createSelectionAnchor(previousText, previousOffset, "after-prefix");
    const beforeSuffix = createSelectionAnchor(previousText, previousOffset, "before-suffix");

    expect(resolveSelectionAnchor(nextText, afterPrefix)).toEqual({
      matched: true,
      offset: "alpha ".length,
    });
    expect(resolveSelectionAnchor(nextText, beforeSuffix)).toEqual({
      matched: true,
      offset: "alpha inserted ".length,
    });
  });

  test("falls back to a clamped offset when no anchor context matches", () => {
    const anchor = createSelectionAnchor("abcdef", 5, "neutral");

    expect(resolveSelectionAnchor("xy", anchor)).toEqual({
      matched: false,
      offset: 2,
    });
  });

  test("matches unchanged text as text continuity", () => {
    const anchor = createSelectionAnchor("alpha target", 6, "neutral");

    expect(hasSelectionAnchorTextContinuity("alpha target", "alpha target", anchor)).toBe(
      true,
    );
  });

  test("matches text continuity when strong shared text resolves the selection anchor", () => {
    const previousText = "alpha target omega";
    const nextText = "alpha inserted target omega";
    const anchor = createSelectionAnchor(previousText, "alpha ".length, "after-prefix");

    expect(hasSelectionAnchorTextContinuity(previousText, nextText, anchor)).toBe(true);
  });

  test("rejects weak overlap without selection-anchor text continuity", () => {
    const previousText = "Target paragraph";
    const nextText = "Changed paragraph";
    const anchor = createSelectionAnchor(previousText, 0, "neutral");

    expect(hasSelectionAnchorTextContinuity(previousText, nextText, anchor)).toBe(false);
  });

  test("matches prefix truncation only at or after the new end", () => {
    const previousText = "Alpha paragraph";
    const nextText = "Alpha";
    const beforeEnd = createSelectionAnchor(previousText, 0, "neutral");
    const atEnd = createSelectionAnchor(previousText, nextText.length, "neutral");

    expect(hasSelectionAnchorTextContinuity(previousText, nextText, beforeEnd)).toBe(false);
    expect(hasSelectionAnchorTextContinuity(previousText, nextText, atEnd)).toBe(true);
  });

  test("rejects empty previous text as text continuity unless text is unchanged", () => {
    const anchor = createSelectionAnchor("", 0, "neutral");

    expect(hasSelectionAnchorTextContinuity("", "alpha", anchor)).toBe(false);
  });
});
