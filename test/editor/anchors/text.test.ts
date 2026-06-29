import { expect, test } from "bun:test";
import {
  createDocument,
  createMention,
  createParagraphBlock,
  createText,
  listAnchorContainers,
} from "@/document";
import { createEditorState } from "@/editor";
import { createEditorTextAnchorResolver } from "@/editor/anchors/text";

test("resolves collapsed semantic points inside references to collapsed editor ranges", () => {
  const document = createDocument([
    createParagraphBlock([
      createText("Hello "),
      createMention({ name: "Jane Doe", userId: "user-123" }),
      createText(" world"),
    ]),
  ]);
  const state = createEditorState(document);
  const container = listAnchorContainers(document)[0];

  if (!container) {
    throw new Error("Expected anchor container");
  }

  const resolver = createEditorTextAnchorResolver(state.documentIndex);
  const semanticOffsetInsideMention = "Hello @Jane".length;
  const baseMatch = {
    containerOrdinal: container.containerOrdinal,
    containerPath: container.path,
    endOffset: semanticOffsetInsideMention,
    startOffset: semanticOffsetInsideMention,
  };
  const beforeMention = resolver.resolveEditorRange(baseMatch, {
    collapsedAffinity: "before",
  });
  const afterMention = resolver.resolveEditorRange(baseMatch, {
    collapsedAffinity: "after",
  });

  expect(beforeMention?.startOffset).toBe("Hello ".length);
  expect(beforeMention?.endOffset).toBe(beforeMention?.startOffset);
  expect(afterMention?.startOffset).toBe("Hello \uFFFC".length);
  expect(afterMention?.endOffset).toBe(afterMention?.startOffset);
});
