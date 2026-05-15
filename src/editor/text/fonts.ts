import type { Mark } from "@/document";

export const codeTextFont = "15px ui-monospace, SFMono-Regular, Menlo, monospace";

export function resolveMarkedTextFont(font: string, marks: readonly Mark[]) {
  return resolveInlineTextFont(font, marks, false);
}

export function resolveInlineTextFont(font: string, marks: readonly Mark[], inlineCode: boolean) {
  const baseFont = inlineCode ? codeTextFont : font;
  const parts: string[] = [];

  if (marks.includes("italic")) {
    parts.push("italic");
  }

  if (marks.includes("bold")) {
    parts.push("700");
  }

  return parts.length > 0 ? `${parts.join(" ")} ${baseFont}` : baseFont;
}
