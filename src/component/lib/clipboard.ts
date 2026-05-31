import { copySelection, insertLink, pasteFragment, type EditorState } from "@/editor";
import { parseFragment, serializeFragment, type MarkdownOptions } from "@/markdown";

export function copySelectionAsMarkdown(state: EditorState): string | null {
  const fragment = copySelection(state);

  return fragment ? serializeFragment(fragment) : null;
}

export function pastePlainText(
  state: EditorState,
  text: string,
  markdownOptions?: MarkdownOptions,
): EditorState | null {
  if (text.length === 0) {
    return null;
  }

  if (/^https?:\/\//.test(text)) {
    const linked = insertLink(state, text);

    if (linked) {
      return linked;
    }
  }

  return pasteFragment(state, parseFragment(text, markdownOptions), text);
}
