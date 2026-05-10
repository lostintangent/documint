import emojis from "./emojis.json";
import type { CompletionItem, CompletionSource } from "../completions";

export const emojiCompletionSource: CompletionSource = {
  trigger: ":",
  items: emojis.map(toCompletionItem),
};

function toCompletionItem(record: string[]): CompletionItem {
  if (record.length !== 2) {
    throw new Error("Emoji completion rows must be [label, value] tuples.");
  }

  const [label, value] = record;

  return {
    label,
    icon: value,
    insertText: value,
  };
}
