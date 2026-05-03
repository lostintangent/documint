import { expect, test } from "bun:test";
import {
  INPUT_SEED,
  isLineBreakInputType,
  resolveDeleteDirection,
  stripInputSeed,
} from "@/component/hooks/useInput";

test("treats both paragraph and line-break input types as structural Enter", () => {
  // iOS Safari emits `insertLineBreak` for the virtual keyboard's Return
  // key regardless of modifier state, so the inputType cannot tell us
  // whether the user wanted a soft break here. Both must collapse to the
  // same structural-Enter route; soft breaks are reachable only via the
  // Shift+Enter keybinding on physical keyboards (handled by `keydown`).
  expect(isLineBreakInputType("insertParagraph")).toBe(true);
  expect(isLineBreakInputType("insertLineBreak")).toBe(true);
  expect(isLineBreakInputType("insertText")).toBe(false);
});

test("normalizes iOS-style backward delete input types", () => {
  expect(resolveDeleteDirection("deleteContentBackward")).toBe("backward");
  expect(resolveDeleteDirection("deleteComposedCharacterBackward")).toBe("backward");
  expect(resolveDeleteDirection("deleteSoftLineBackward")).toBe("backward");
  expect(resolveDeleteDirection("deleteHardLineBackward")).toBe("backward");
  expect(resolveDeleteDirection("deleteWordBackward")).toBe("backward");
});

test("normalizes forward delete input types", () => {
  expect(resolveDeleteDirection("deleteContentForward")).toBe("forward");
  expect(resolveDeleteDirection("deleteSoftLineForward")).toBe("forward");
  expect(resolveDeleteDirection("deleteHardLineForward")).toBe("forward");
  expect(resolveDeleteDirection("deleteWordForward")).toBe("forward");
});

test("ignores unrelated input types", () => {
  expect(resolveDeleteDirection("insertText")).toBeNull();
});

test("strips the hidden input seed from native text", () => {
  expect(stripInputSeed(`${INPUT_SEED}a${INPUT_SEED}b`)).toBe("ab");
  expect(stripInputSeed(INPUT_SEED)).toBe("");
});
