import type { Mark } from "@/document";
import { Bold, Italic, Strikethrough, Superscript, Underline, type LucideIcon } from "lucide-react";

export type FormattingMarkDescriptor = {
  group: "leading" | "trailing";
  icon: LucideIcon;
  label: string;
  mark: Mark;
};

export const formattingMarkDescriptors = [
  { group: "leading", icon: Bold, label: "Bold", mark: "bold" },
  { group: "leading", icon: Italic, label: "Italic", mark: "italic" },
  { group: "leading", icon: Underline, label: "Underline", mark: "underline" },
  {
    group: "trailing",
    icon: Strikethrough,
    label: "Strikethrough",
    mark: "strikethrough",
  },
  { group: "trailing", icon: Superscript, label: "Superscript", mark: "superscript" },
] satisfies readonly FormattingMarkDescriptor[];
