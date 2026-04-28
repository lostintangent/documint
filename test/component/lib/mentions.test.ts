import { describe, expect, test } from "bun:test";
import { extractMentionedUserIds, tokenizeTriggers } from "@/component/lib/mentions";
import type { CompletionSource } from "@/component/overlays/leaves/core/LeafInput";

const userSource: CompletionSource = {
  trigger: "@",
  items: [
    { label: "Jane", id: "u-jane" },
    { label: "Jane Doe", id: "u-jane-doe" },
    { label: "John", id: "u-john" },
  ],
};

describe("tokenizeTriggers", () => {
  test("returns a single text segment when no triggers are present", () => {
    expect(tokenizeTriggers("nothing to see here", [userSource])).toEqual([
      { kind: "text", text: "nothing to see here" },
    ]);
  });

  test("tokenizes a mention at the start of the body", () => {
    expect(tokenizeTriggers("@Jane shipped it", [userSource])).toEqual([
      { kind: "token", trigger: "@", label: "Jane", id: "u-jane" },
      { kind: "text", text: " shipped it" },
    ]);
  });

  test("tokenizes a mention after whitespace", () => {
    expect(tokenizeTriggers("hi @John!", [userSource])).toEqual([
      { kind: "text", text: "hi " },
      { kind: "token", trigger: "@", label: "John", id: "u-john" },
      { kind: "text", text: "!" },
    ]);
  });

  test("prefers the longest matching label", () => {
    expect(tokenizeTriggers("@Jane Doe wrote this", [userSource])).toEqual([
      { kind: "token", trigger: "@", label: "Jane Doe", id: "u-jane-doe" },
      { kind: "text", text: " wrote this" },
    ]);
  });

  test("does not match a trigger embedded inside a word", () => {
    expect(tokenizeTriggers("email@Jane.com", [userSource])).toEqual([
      { kind: "text", text: "email@Jane.com" },
    ]);
  });

  test("ignores triggers that don't match any source item", () => {
    expect(tokenizeTriggers("@Unknown person", [userSource])).toEqual([
      { kind: "text", text: "@Unknown person" },
    ]);
  });

  test("returns a single text segment when no sources are provided", () => {
    expect(tokenizeTriggers("@Jane", undefined)).toEqual([{ kind: "text", text: "@Jane" }]);
  });
});

describe("extractMentionedUserIds", () => {
  test("returns the IDs of mentioned users in first-occurrence order", () => {
    expect(extractMentionedUserIds("hey @John and @Jane Doe", [userSource])).toEqual([
      "u-john",
      "u-jane-doe",
    ]);
  });

  test("dedupes repeated mentions", () => {
    expect(extractMentionedUserIds("@Jane @Jane and @John", [userSource])).toEqual([
      "u-jane",
      "u-john",
    ]);
  });

  test("returns an empty array when nobody is mentioned", () => {
    expect(extractMentionedUserIds("nothing to see", [userSource])).toEqual([]);
  });

  test("returns an empty array when the roster is empty", () => {
    expect(extractMentionedUserIds("@Jane", undefined)).toEqual([]);
  });

  test("ignores triggers from non-'@' sources", () => {
    const slashSource: CompletionSource = {
      trigger: "/",
      items: [{ label: "deploy", id: "cmd-deploy" }],
    };
    expect(extractMentionedUserIds("/deploy and @Jane", [userSource, slashSource])).toEqual([
      "u-jane",
    ]);
  });

  test("skips items that don't carry an id", () => {
    const sourceWithoutIds: CompletionSource = {
      trigger: "@",
      items: [{ label: "Anon" }],
    };
    expect(extractMentionedUserIds("@Anon waved", [sourceWithoutIds])).toEqual([]);
  });
});
