// The host theme contract. Hosts pass an `EditorTheme` with the four tier-1
// colors, and the component resolves the optional tokens into a
// `ResolvedEditorTheme`. Paint is its lowest reader. The component also maps
// chrome tokens to CSS variables and forwards metrics to layout options.

export type CodeTokenKind =
  // Source-language tokens.
  | "keyword"
  | "string"
  | "comment"
  | "number"
  | "function"
  | "type"
  // Named primitive/singleton literal values like `true`, `null`, and
  // `undefined`; strings and numbers keep their own syntax-specific tokens.
  | "atom"
  | "punctuation"
  // Markup/document tokens for languages like Markdown and HTML-like sources.
  | "heading"
  | "emphasis"
  | "strong"
  | "link"
  // Built-in tokens cover shared syntax categories. Hosts can use custom token
  // names for domain-specific code fences; unresolved custom tokens fall back
  // to `codeText` unless the theme provides `codeTokens[token]`.
  | (string & {});

export type EditorTheme = {
  // Tier-1 required tokens that
  // everything else is derived from
  accent: string;
  background: string;
  muted: string;
  text: string;

  // Tier-2 tokens that are optional
  // and have sensible defaults when omitted.
  activeBlockBackground?: string;
  activeBlockFlash?: string;
  blockquoteRule?: string;
  blockquoteRuleActive?: string;
  blockquoteText?: string;
  caret?: string;
  checkboxCheckmark?: string;
  checkboxCheckedFill?: string;
  checkboxUncheckedFill?: string;
  checkboxUncheckedStroke?: string;
  codeBackground?: string;
  codeTokens?: Partial<Record<CodeTokenKind, string>>;
  codeText?: string;
  commentHighlight?: string;
  commentHighlightActive?: string;
  commentHighlightResolved?: string;
  commentHighlightResolvedActive?: string;
  dividerRule?: string;
  externalChangeAdditionBackground?: string;
  externalChangeDeletionBackground?: string;
  externalChangeModificationBackground?: string;
  fontSize?: number;
  headingRule?: string;
  headingText?: string;
  imageLoadingOverlay?: string;
  imagePlaceholderIcon?: string;
  imagePlaceholderText?: string;
  imageSurfaceBackground?: string;
  imageSurfaceBorder?: string;
  inlineCodeBackground?: string;
  inlineCodeText?: string;
  insertHighlightText?: string;
  leafAccent?: string;
  leafBackground?: string;
  leafBorder?: string;
  leafInputBackground?: string;
  leafButtonText?: string;
  leafSecondaryText?: string;
  leafShadow?: string;
  leafText?: string;
  linkText?: string;
  listMarkerText?: string;
  mentionBackground?: string;
  mentionText?: string;
  paddingX?: number;
  paddingY?: number;
  paragraphText?: string;
  selectionBackground?: string;
  selectionHandleBackground?: string;
  selectionHandleBorder?: string;
  scrollbar?: string;
  tableBodyBackground?: string;
  tableBorder?: string;
  tableHeaderBackground?: string;
};

export type ResolvedEditorTheme = Required<EditorTheme>;
