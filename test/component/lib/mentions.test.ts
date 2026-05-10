import { describe, expect, test } from "bun:test";
import type { CompletionSource } from "@/component/completions/completions";
import { extractMentionedUserIds } from "@/component/lib/mentions";

const userSource: CompletionSource = {
  trigger: "@",
  items: [
    { label: "Jane", id: "u-jane" },
    { label: "Jane Doe", id: "u-jane-doe" },
    { label: "John", id: "u-john" },
  ],
};

const emojiSource: CompletionSource = {
  trigger: ":",
  items: [
    { label: "smile", id: "emoji-smile" },
    { label: "wave", id: "emoji-wave" },
  ],
};

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

  test("ignores non-'@' trigger tokens even when they tokenize", () => {
    expect(extractMentionedUserIds(":smile and @Jane", [userSource, emojiSource])).toEqual([
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
