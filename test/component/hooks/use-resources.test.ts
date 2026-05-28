import { expect, test } from "bun:test";
import {
  createResourceProtocolLayoutKey,
  createResourceProtocolKey,
  normalizeResourceProtocolMap,
  resolveDiscoveredResourceReferences,
} from "@/component/hooks/useResources";

test("normalizes resource protocol registry keys", () => {
  const protocols = normalizeResourceProtocolMap({
    "Demo-Resource": { icon: "R", label: "Demo" },
    "issue:": { label: "Issue" },
  });

  expect([...protocols.keys()]).toEqual(["demo-resource:", "issue:"]);
});

test("creates a stable resource protocol key from canonical keys", () => {
  const first = normalizeResourceProtocolMap({
    "issue:": { label: "Issue" },
    "demo-resource": { label: "Demo" },
  });
  const second = normalizeResourceProtocolMap({
    "demo-resource:": { label: "Demo" },
    issue: { label: "Issue" },
  });

  expect(createResourceProtocolKey(first)).toBe(createResourceProtocolKey(second));
});

test("separates parser protocol identity from layout-affecting metadata", () => {
  const first = normalizeResourceProtocolMap({
    "demo-resource:": { icon: "R", label: "Demo" },
  });
  const renamed = normalizeResourceProtocolMap({
    "demo-resource:": { icon: "N", label: "Note" },
  });

  expect(createResourceProtocolKey(first)).toBe(createResourceProtocolKey(renamed));
  expect(createResourceProtocolLayoutKey(first)).not.toBe(createResourceProtocolLayoutKey(renamed));
});

test("resolves discovered document resources from indexed URLs", () => {
  const protocols = normalizeResourceProtocolMap({
    "demo-resource:": { label: "Demo" },
  });
  const discovered = resolveDiscoveredResourceReferences(
    new Set([
      "demo-resource://recording/live",
      "demo-resource://note/complete",
      "unknown-resource://ignored",
    ]),
    protocols,
  );

  expect(discovered).toEqual([
    {
      protocol: "demo-resource:",
      url: "demo-resource://recording/live",
    },
    {
      protocol: "demo-resource:",
      url: "demo-resource://note/complete",
    },
  ]);
});
