// Owns cheap text-only layout estimates used before exact measurement.

import { defaultDocumentLayoutOptions } from "../lib/options";

export type TextLayoutEstimate = {
  estimatedHeight: number;
  lineCount: number;
  width: number;
};

export function estimateTextLayout(input: {
  text: string;
  width: number;
  charWidth?: number;
  lineHeight?: number;
}): TextLayoutEstimate {
  const charWidth = input.charWidth ?? defaultDocumentLayoutOptions.charWidth;
  const lineHeight = input.lineHeight ?? defaultDocumentLayoutOptions.lineHeight;
  const charactersPerLine = Math.max(12, Math.floor(input.width / charWidth));
  const lineCount = countEstimatedLines(input.text, charactersPerLine);

  return {
    estimatedHeight: lineCount * lineHeight,
    lineCount,
    width: input.width,
  };
}

function countEstimatedLines(text: string, charactersPerLine: number) {
  let lineCount = 0;
  let segmentLength = 0;

  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) === 0x0a) {
      lineCount += Math.max(1, Math.ceil(segmentLength / charactersPerLine));
      segmentLength = 0;
      continue;
    }

    segmentLength += 1;
  }

  // Count the final segment. This also preserves the previous `split("\n")`
  // behavior where a trailing newline contributes one empty visual line.
  return lineCount + Math.max(1, Math.ceil(segmentLength / charactersPerLine));
}
