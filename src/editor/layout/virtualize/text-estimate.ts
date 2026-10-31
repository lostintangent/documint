// Owns cheap text-only layout estimates used before exact measurement.

// Estimates wrapped text height from a fixed character width. Every text
// counts at least one line, so empty text still reserves one line height.
export function estimateTextHeight(
  text: string,
  width: number,
  charWidth: number,
  lineHeight: number,
) {
  const charactersPerLine = Math.max(12, Math.floor(width / charWidth));

  return countEstimatedLines(text, charactersPerLine) * lineHeight;
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
