import { createImage, type Image } from "@/document";
import type { EditorStateAction } from "../../../types";
import { spliceInlineContainer, type InlineContainer } from "./shared";

export type ImageResizeTarget = {
  end: number;
  image: Image;
  start: number;
};

export function resolveImageResize(
  inlineContainer: InlineContainer,
  inline: ImageResizeTarget,
  newWidth: number,
): EditorStateAction {
  const { image } = inline;
  const replacement = spliceInlineContainer(inlineContainer, inline.start, inline.end, [
    createImage({
      alt: image.alt,
      title: image.title,
      url: image.url,
      width: newWidth,
    }),
  ]);

  // Resizing an existing image should preserve the current selection rather
  // than move the caret to the resized object's replacement position.
  return {
    kind: "replace-block",
    block: replacement.block,
    blockId: replacement.blockId,
  };
}
