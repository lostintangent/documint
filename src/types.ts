import type { Anchor } from "@/document";

export type DocumentImageResource = {
  intrinsicHeight: number;
  intrinsicWidth: number;
  source: CanvasImageSource | null;
  status: "error" | "loaded" | "loading";
};

export type DocumentResources = {
  images: Map<string, DocumentImageResource>;
};

export type EditorCommand =
  | "dedent"
  | "deleteBackward"
  | "indent"
  | "insertLineBreak"
  | "moveListItemDown"
  | "moveListItemUp"
  | "moveToDocumentEnd"
  | "moveToDocumentStart"
  | "moveToLineEnd"
  | "moveToLineStart"
  | "redo"
  | "selectAll"
  | "toggleBold"
  | "toggleInlineCode"
  | "toggleItalic"
  | "toggleStrikethrough"
  | "toggleUnderline"
  | "undo";

export type EditorTheme = {
  activeBlockBackground: string;
  activeBlockFlash: string;
  background: string;
  blockquoteRule: string;
  blockquoteRuleActive: string;
  blockquoteText: string;
  caret: string;
  checkboxCheckmark: string;
  checkboxCheckedFill: string;
  checkboxCheckedStroke: string;
  checkboxUncheckedFill: string;
  checkboxUncheckedStroke: string;
  codeBackground: string;
  codeText: string;
  commentHighlight: string;
  commentHighlightActive: string;
  commentHighlightResolved: string;
  commentHighlightResolvedActive: string;
  headingRule: string;
  headingText: string;
  imageLoadingOverlay: string;
  imagePlaceholderIcon: string;
  imagePlaceholderText: string;
  imageSurfaceBackground: string;
  imageSurfaceBorder: string;
  inlineCodeBackground: string;
  inlineCodeText: string;
  insertHighlightText: string;
  leafAccent: string;
  leafBackground: string;
  leafBorder: string;
  leafButtonBackground: string;
  leafButtonBorder: string;
  leafButtonText: string;
  leafResolvedBackground: string;
  leafResolvedBorder: string;
  leafSecondaryText: string;
  leafShadow?: string;
  leafText: string;
  linkText: string;
  listMarkerText: string;
  paddingX: number;
  paddingY: number;
  paragraphText: string;
  selectionBackground: string;
  selectionHandleBackground: string;
  selectionHandleBorder: string;
  tableBodyBackground: string;
  tableBorder: string;
  tableHeaderBackground: string;
};

export type Presence = {
  color?: string;
  cursor?: Anchor;
  imageUrl?: string;
  name: string;
};
