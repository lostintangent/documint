import type { Mark } from "@/document";

export function resolveMarkedTextFont(font: string, marks: readonly Mark[]) {
  const parts: string[] = [];

  if (marks.includes("italic")) {
    parts.push("italic");
  }

  if (marks.includes("bold")) {
    parts.push("700");
  }

  return parts.length > 0 ? `${parts.join(" ")} ${font}` : font;
}
