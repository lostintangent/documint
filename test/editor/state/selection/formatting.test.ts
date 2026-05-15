import { expect, test } from "bun:test";
import { getSelectionFormatting } from "@/editor/state";
import { getRegion, selectIn, selectSubstring, setup } from "../../helpers";

test("detects when selected text is inline code", () => {
  const state = setup("Use `code` and plain text.\n");
  const region = getRegion(state, "Use code and plain text.");

  expect(getSelectionFormatting(selectSubstring(state, region, "code"))).toEqual({
    code: true,
    marks: [],
  });
  expect(getSelectionFormatting(selectSubstring(state, region, "plain"))).toEqual({
    code: false,
    marks: [],
  });
  expect(
    getSelectionFormatting(selectIn(state, region, "Use ".length, "Use code and".length)),
  ).toEqual({
    code: false,
    marks: [],
  });

  const breakState = setup("Use `code`<br>next\n");
  const breakRegion = getRegion(breakState, "Use code\nnext");

  expect(getSelectionFormatting(selectIn(breakState, breakRegion, 4, 9))).toEqual({
    code: false,
    marks: [],
  });
});
