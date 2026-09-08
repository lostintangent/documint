import { describe, expect, test } from "bun:test";
import { createEditorLayoutState, measureCaretTarget } from "@/editor/layout";
import { measureLayoutSlice } from "@/editor/layout/measure";
import { metadataKeyPath, metadataValuePath } from "@/editor/state";
import { CHECKBOX_SIZE } from "@/editor/layout/lib/marker-metrics";
import { setup } from "../helpers";

const structuredMetadataFixture = `---
title: Draft
description: |-
  First line
  Second line
draft: true
---
Body one

Body two
`;

describe("Metadata prefix layout", () => {
  test("defaults collapsed and lays out strings, multiline values, and booleans when expanded", () => {
    const state = setup(structuredMetadataFixture);
    const options = {
      paddingX: 12,
      paddingY: 12,
      width: 420,
    };
    const collapsed = measureLayoutSlice(state.documentIndex, {
      ...options,
    });
    const layout = measureLayoutSlice(state.documentIndex, {
      ...options,
      metadataExpanded: true,
    });
    const metadata = layout.metadata;

    expect(collapsed.metadata?.expanded).toBe(false);
    expect(collapsed.metadata?.rows).toEqual([]);

    if (!metadata) {
      throw new Error("Expected metadata layout");
    }

    expect(layout.height).toBeGreaterThan(collapsed.height);
    expect(metadata.header).toMatchObject({
      height: layout.options.lineHeight + 8,
      left: 12,
      top: 12,
    });
    expect(metadata.rows).toHaveLength(3);

    const titleRow = metadata.rows[0];
    const descriptionRow = metadata.rows[1];
    const booleanRow = metadata.rows[2];

    if (!titleRow || !descriptionRow || !booleanRow) {
      throw new Error("Expected structured metadata rows");
    }

    expect(titleRow.keyRect.left + titleRow.keyRect.width).toBe(titleRow.valueRect.left);
    expect(titleRow.valueRect.left + titleRow.valueRect.width).toBe(
      metadata.header.left + metadata.header.width,
    );
    expect(titleRow.keyRect.width).toBeLessThan(titleRow.valueRect.width);
    const descriptionLines = layout.lines.filter((line) => line.path === metadataValuePath(1));
    expect(descriptionLines.map((line) => line.text)).toEqual(["First line", "Second line"]);
    expect(descriptionRow.valueRect.height).toBeGreaterThan(titleRow.valueRect.height);

    expect(booleanRow.checkbox).toMatchObject({
      checked: true,
      path: metadataValuePath(2),
      rect: {
        height: CHECKBOX_SIZE,
        width: CHECKBOX_SIZE,
      },
    });
    expect(layout.lines.some((line) => line.path === metadataValuePath(2))).toBe(false);
    expect(
      measureCaretTarget(layout, state.documentIndex, {
        path: metadataValuePath(2),
        offset: 0,
      }),
    ).toBeNull();

    const keyLine = layout.lines.find((line) => line.path === metadataKeyPath(0));
    const valueLine = layout.lines.find((line) => line.path === metadataValuePath(0));

    expect(keyLine?.font).not.toContain("700");
    expect(valueLine?.font).not.toContain("700");
  });

  test.each([
    ["absent", "Body\n"],
    [
      "raw",
      `---
# retained comment
nested:
  value: true
---
Body
`,
    ],
  ])("keeps %s metadata off the body layout path", (_kind, markdown) => {
    const state = setup(markdown);
    const layout = measureLayoutSlice(state.documentIndex, {
      metadataExpanded: false,
      paddingX: 12,
      paddingY: 18,
      width: 420,
    });

    expect(layout.metadata).toBeNull();
    expect(layout.lines[0]).toMatchObject({ text: "Body", top: 18 });
  });

  test("wraps long metadata keys and values with shared grid row growth", () => {
    const state = setup(`---
very_long_metadata_key_name: value words repeat until the metadata value wraps
---
Body
`);
    const layout = measureLayoutSlice(state.documentIndex, {
      metadataExpanded: true,
      width: 220,
    });
    const row = layout.metadata?.rows[0];

    if (!row) {
      throw new Error("Expected wrapped structured metadata row");
    }

    const keyLines = layout.lines.filter((line) => line.path === metadataKeyPath(0));
    const valueLines = layout.lines.filter((line) => line.path === metadataValuePath(0));

    expect(keyLines.length).toBeGreaterThan(1);
    expect(valueLines.length).toBeGreaterThan(1);
    expect(row.valueRect.height).toBeGreaterThan(layout.options.lineHeight + 16);
  });

  test("measures metadata text carets without block semantics", () => {
    const state = setup(structuredMetadataFixture);
    const layoutState = createEditorLayoutState(state, {
      height: 320,
      metadataExpanded: true,
      top: 0,
      width: 420,
    });
    const valuePath = metadataValuePath(0);
    const caret = measureCaretTarget(layoutState.layout, state.documentIndex, {
      path: valuePath,
      offset: 3,
    });

    if (!caret) {
      throw new Error("Expected metadata value caret");
    }

    expect(caret.blockPath).toBeNull();
    expect(caret.path).toBe(valuePath);
  });
});
