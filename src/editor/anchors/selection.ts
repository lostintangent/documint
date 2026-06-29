import {
  captureContextWindows,
  clamp,
  enumerateTextAnchorRanges,
  type TextAnchor,
} from "@/document";

export type SelectionAnchorAffinity = "after-prefix" | "before-suffix" | "neutral";

export type SelectionAnchor = {
  affinity: SelectionAnchorAffinity;
  offset: number;
  textAnchor: TextAnchor;
};

export type SelectionAnchorResolution = {
  matched: boolean;
  offset: number;
};

// Minimum share of old runtime text that must survive before a resolved
// selection anchor is treated as continuous across snapshots.
const selectionAnchorTextContinuityThreshold = 0.75;

export function createSelectionAnchor(
  text: string,
  offset: number,
  affinity: SelectionAnchorAffinity,
): SelectionAnchor {
  const capturedOffset = clamp(offset, 0, text.length);
  const { prefix, suffix } = captureContextWindows(text, capturedOffset, capturedOffset);

  return {
    affinity,
    offset,
    textAnchor: {
      prefix: prefix || undefined,
      suffix: suffix || undefined,
    },
  };
}

export function resolveSelectionAnchor(
  text: string,
  anchor: SelectionAnchor,
): SelectionAnchorResolution {
  const contextOffset = resolveUniquePointOffset(
    enumerateTextAnchorRanges(text, anchor.textAnchor).filter(
      (range) => range.startOffset === range.endOffset,
    ),
  );

  if (contextOffset !== null) {
    return { matched: true, offset: contextOffset };
  }

  const prefixOffset = resolveUniquePointOffset(
    enumerateTextAnchorRanges(text, { prefix: anchor.textAnchor.prefix }),
  );
  const suffixOffset = resolveUniquePointOffset(
    enumerateTextAnchorRanges(text, { suffix: anchor.textAnchor.suffix }),
  );

  if (anchor.affinity === "before-suffix") {
    const anchoredOffset = suffixOffset ?? prefixOffset;
    return anchoredOffset !== null
      ? { matched: true, offset: anchoredOffset }
      : { matched: false, offset: clamp(anchor.offset, 0, text.length) };
  }

  const anchoredOffset = prefixOffset ?? suffixOffset;
  return anchoredOffset !== null
    ? { matched: true, offset: anchoredOffset }
    : { matched: false, offset: clamp(anchor.offset, 0, text.length) };
}

export function hasSelectionAnchorTextContinuity(
  previousText: string,
  nextText: string,
  pointAnchor: SelectionAnchor,
) {
  if (previousText === nextText) {
    return true;
  }

  return (
    (hasEnoughSharedText(previousText, nextText) &&
      resolveSelectionAnchor(nextText, pointAnchor).matched) ||
    isPrefixTruncationAtOffset(previousText, nextText, pointAnchor.offset)
  );
}

function resolveUniquePointOffset(ranges: Array<{ startOffset: number; endOffset: number }>) {
  return ranges.length === 1 ? ranges[0]!.startOffset : null;
}

function hasEnoughSharedText(previousText: string, nextText: string) {
  if (previousText.length === 0 || nextText.length === 0) {
    return false;
  }

  const prefixLength = commonPrefixLength(previousText, nextText);
  const suffixLength = Math.min(
    commonSuffixLength(previousText, nextText),
    previousText.length - prefixLength,
    nextText.length - prefixLength,
  );
  const coveredLength = prefixLength + suffixLength;
  const shorterLength = Math.min(previousText.length, nextText.length);

  return (
    coveredLength === shorterLength ||
    coveredLength / previousText.length >= selectionAnchorTextContinuityThreshold
  );
}

function isPrefixTruncationAtOffset(previousText: string, nextText: string, offset: number) {
  return (
    nextText.length > 0 &&
    previousText.startsWith(nextText) &&
    clamp(offset, 0, previousText.length) >= nextText.length
  );
}

function commonPrefixLength(left: string, right: string) {
  const length = Math.min(left.length, right.length);

  for (let index = 0; index < length; index += 1) {
    if (left[index] !== right[index]) {
      return index;
    }
  }

  return length;
}

function commonSuffixLength(left: string, right: string) {
  const length = Math.min(left.length, right.length);

  for (let index = 1; index <= length; index += 1) {
    if (left[left.length - index] !== right[right.length - index]) {
      return index - 1;
    }
  }

  return length;
}
