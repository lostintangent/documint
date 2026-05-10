export function containsColorEmoji(text: string) {
  return colorEmojiPattern.test(text);
}

const colorEmojiPattern = /[\uFE0F\u{1F1E6}-\u{1F1FF}\p{Extended_Pictographic}]/u;
