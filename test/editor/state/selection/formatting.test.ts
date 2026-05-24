import { describe, expect, test } from "bun:test";
import { getSelectionFormatting } from "@/editor/state";
import { getRegion, selectIn, selectSubstring, setup } from "../../helpers";

describe("Selection formatting", () => {
  test("detects when selected text is inline code", () => {
    const state = setup("Use `code` and plain text.\n");
    const region = getRegion(state, "Use code and plain text.");

    expect(getSelectionFormatting(selectSubstring(state, region, "code"))).toEqual({
      code: true,
      marks: [],
      supported: true,
    });
    expect(getSelectionFormatting(selectSubstring(state, region, "plain"))).toEqual({
      code: false,
      marks: [],
      supported: true,
    });
    expect(
      getSelectionFormatting(selectIn(state, region, "Use ".length, "Use code and".length)),
    ).toEqual({
      code: false,
      marks: [],
      supported: true,
    });

    const breakState = setup("Use `code`<br>next\n");
    const breakRegion = getRegion(breakState, "Use code\nnext");

    expect(getSelectionFormatting(selectIn(breakState, breakRegion, 4, 9))).toEqual({
      code: false,
      marks: [],
      supported: true,
    });
  });

  test("disables inline formatting for source text selections", () => {
    const state = setup("```ts\nconst value = 1;\n```\n");
    const region = getRegion(state, "const value = 1;");

    expect(getSelectionFormatting(selectSubstring(state, region, "value"))).toEqual({
      code: false,
      marks: [],
      supported: false,
    });
  });
});
