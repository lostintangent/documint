import { describe, expect, test } from "bun:test";
import { equalShallowObject } from "@/component/store/core/equality";

describe("store equality helpers", () => {
  test("compares typed objects by shallow owned properties", () => {
    const token = {};

    expect(equalShallowObject({ count: 1, token }, { count: 1, token })).toBe(true);
    expect(equalShallowObject({ count: 1, token }, { count: 2, token })).toBe(false);
    expect(equalShallowObject({ count: 1, token }, { count: 1, token: {} })).toBe(false);
    expect(equalShallowObject({ count: 1, token }, { count: 1, token, extra: true })).toBe(false);
    expect(equalShallowObject(null, null)).toBe(true);
    expect(equalShallowObject(null, { count: 1 })).toBe(false);
  });
});
