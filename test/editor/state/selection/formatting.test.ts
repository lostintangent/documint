import { describe, expect, test } from "bun:test";
import { getSelectionFormatting } from "@/editor/state";
import { getPath, selectIn, selectSubstring, setup } from "../../helpers";

describe("Selection formatting", () => {
  test("detects code as a standard selected mark", () => {
    const state = setup("Use `code` and plain text.\n");
    const path = getPath(state, "Use code and plain text.");

    expect(getSelectionFormatting(selectSubstring(state, path, "code"))).toEqual({
      marks: ["code"],
      supported: true,
    });
    expect(getSelectionFormatting(selectSubstring(state, path, "plain"))).toEqual({
      marks: [],
      supported: true,
    });
    expect(
      getSelectionFormatting(selectIn(state, path, "Use ".length, "Use code and".length)),
    ).toEqual({
      marks: [],
      supported: true,
    });

    const breakState = setup("Use `code`<br>next\n");
    const breakPath = getPath(breakState, "Use code\nnext");

    expect(getSelectionFormatting(selectIn(breakState, breakPath, 4, 9))).toEqual({
      marks: [],
      supported: true,
    });
  });

  test("disables inline formatting for source text selections", () => {
    const state = setup("```ts\nconst value = 1;\n```\n");
    const path = getPath(state, "const value = 1;");

    expect(getSelectionFormatting(selectSubstring(state, path, "value"))).toEqual({
      marks: [],
      supported: false,
    });
  });
});
