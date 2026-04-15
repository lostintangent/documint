/**
 * Canvas render themes for the editor surface. These tokens are intentionally
 * semantic so paint code can stay focused on structure rather than color
 * decisions.
 */
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
