import { expect, test } from "bun:test";
import {
  INPUT_SEED,
  isLineBreakInputType,
  resolveDeleteDirection,
  stripInputSeed,
} from "@/component/hooks/useNativeInput";

test("recognizes both paragraph and line-break input types", () => {
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
