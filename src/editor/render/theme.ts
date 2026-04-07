/**
 * Canvas render themes for the editor surface. These tokens are intentionally
 * semantic so paint code can stay focused on structure rather than color
 * decisions.
 */
export type EditorTheme = {
  activeBlockBackground: string;
  activeBlockFlash: string;
  blockquoteRuleActive: string;
  blockquoteRule: string;
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
  insertHighlightText: string;
  headingText: string;
  imageSurfaceBackground: string;
  imageSurfaceBorder: string;
  imagePlaceholderIcon: string;
  imagePlaceholderText: string;
  imageLoadingOverlay: string;
  inlineCodeBackground: string;
  inlineCodeText: string;
  leafButtonBackground: string;
  leafButtonBorder: string;
  leafButtonText: string;
  leafAccent: string;
  leafBackground: string;
  leafBorder: string;
  leafShadow?: string;
  leafSecondaryText: string;
  leafResolvedBackground: string;
  leafResolvedBorder: string;
  leafText: string;
  linkText: string;
  listMarkerText: string;
  paddingX: number;
  paddingY: number;
  paragraphText: string;
  blockquoteText: string;
  selectionBackground: string;
  selectionHandleBackground: string;
  selectionHandleBorder: string;
  background: string;
  tableBodyBackground: string;
  tableBorder: string;
  tableHeaderBackground: string;
};

export const lightEditorTheme: EditorTheme = {
  activeBlockBackground: "#fff1c7",
  activeBlockFlash: "rgba(245, 158, 11, 0.28)",
  blockquoteRuleActive: "rgba(124, 45, 18, 0.36)",
  blockquoteRule: "rgba(14, 116, 144, 0.2)",
  caret: "#111827",
  checkboxCheckmark: "#f8fafc",
  checkboxCheckedFill: "#0f766e",
  checkboxCheckedStroke: "#0f766e",
  checkboxUncheckedFill: "#fcfffe",
  checkboxUncheckedStroke: "#64748b",
  codeBackground: "#0f172a",
  codeText: "#e2e8f0",
  commentHighlight: "#d7e3fc",
  commentHighlightActive: "#f4d35e",
  commentHighlightResolved: "#cfe9d8",
  commentHighlightResolvedActive: "#8dc4a0",
  headingRule: "rgba(15, 23, 42, 0.18)",
  insertHighlightText: "#2563eb",
  headingText: "#0f172a",
  imageSurfaceBackground: "rgba(240, 249, 255, 0.98)",
  imageSurfaceBorder: "rgba(14, 116, 144, 0.22)",
  imagePlaceholderIcon: "rgba(14, 116, 144, 0.42)",
  imagePlaceholderText: "rgba(15, 23, 42, 0.58)",
  imageLoadingOverlay: "rgba(255, 255, 255, 0.42)",
  inlineCodeBackground: "rgba(15, 23, 42, 0.08)",
  inlineCodeText: "#7c2d12",
  leafButtonBackground: "rgba(15, 23, 42, 0.08)",
  leafButtonBorder: "rgba(148, 163, 184, 0.55)",
  leafButtonText: "#1f2937",
  leafAccent: "#1d4ed8",
  leafBackground: "#fcfbf7",
  leafBorder: "rgba(148, 163, 184, 0.55)",
  leafShadow: "0 14px 40px rgba(15, 23, 42, 0.16)",
  leafSecondaryText: "#334155",
  leafResolvedBackground: "#cfe9d8",
  leafResolvedBorder: "#8dc4a0",
  leafText: "#1f2937",
  linkText: "#1d4ed8",
  listMarkerText: "#1f2937",
  paddingX: 16,
  paddingY: 12,
  paragraphText: "#1f2937",
  blockquoteText: "#334155",
  selectionBackground: "rgba(125, 211, 252, 0.35)",
  selectionHandleBackground: "#fcfbf7",
  selectionHandleBorder: "#1d4ed8",
  background: "#fcfbf7",
  tableBodyBackground: "rgba(248, 250, 252, 0.98)",
  tableBorder: "rgba(148, 163, 184, 0.55)",
  tableHeaderBackground: "rgba(226, 232, 240, 0.95)",
};

export const darkEditorTheme: EditorTheme = {
  activeBlockBackground: "rgba(125, 211, 252, 0.12)",
  activeBlockFlash: "rgba(226, 232, 240, 0.12)",
  blockquoteRuleActive: "rgba(125, 211, 252, 0.5)",
  blockquoteRule: "rgba(103, 232, 249, 0.34)",
  caret: "#f8fafc",
  checkboxCheckmark: "#082f49",
  checkboxCheckedFill: "#67e8f9",
  checkboxCheckedStroke: "#67e8f9",
  checkboxUncheckedFill: "#0f172a",
  checkboxUncheckedStroke: "#64748b",
  codeBackground: "#020617",
  codeText: "#dbeafe",
  commentHighlight: "rgba(96, 165, 250, 0.34)",
  commentHighlightActive: "#facc15",
  commentHighlightResolved: "rgba(74, 222, 128, 0.24)",
  commentHighlightResolvedActive: "#4ade80",
  headingRule: "rgba(226, 232, 240, 0.22)",
  insertHighlightText: "#60a5fa",
  headingText: "#f8fafc",
  imageSurfaceBackground: "rgba(15, 23, 42, 0.92)",
  imageSurfaceBorder: "rgba(56, 189, 248, 0.28)",
  imagePlaceholderIcon: "rgba(125, 211, 252, 0.44)",
  imagePlaceholderText: "rgba(226, 232, 240, 0.62)",
  imageLoadingOverlay: "rgba(186, 230, 253, 0.18)",
  inlineCodeBackground: "rgba(148, 163, 184, 0.16)",
  inlineCodeText: "#fdba74",
  leafButtonBackground: "rgba(148, 163, 184, 0.16)",
  leafButtonBorder: "rgba(100, 116, 139, 0.7)",
  leafButtonText: "#dbe4f0",
  leafAccent: "#93c5fd",
  leafBackground: "#0b1220",
  leafBorder: "rgba(100, 116, 139, 0.7)",
  leafShadow: "0 18px 44px rgba(2, 6, 23, 0.42), 0 0 0 1px rgba(148, 163, 184, 0.06)",
  leafSecondaryText: "#cbd5e1",
  leafResolvedBackground: "rgba(74, 222, 128, 0.24)",
  leafResolvedBorder: "#4ade80",
  leafText: "#dbe4f0",
  linkText: "#93c5fd",
  listMarkerText: "#e2e8f0",
  paddingX: 16,
  paddingY: 12,
  paragraphText: "#dbe4f0",
  blockquoteText: "#cbd5e1",
  selectionBackground: "rgba(56, 189, 248, 0.28)",
  selectionHandleBackground: "#0b1220",
  selectionHandleBorder: "#93c5fd",
  background: "#0b1220",
  tableBodyBackground: "rgba(15, 23, 42, 0.9)",
  tableBorder: "rgba(100, 116, 139, 0.7)",
  tableHeaderBackground: "rgba(30, 41, 59, 0.96)",
};

export const mintEditorTheme: EditorTheme = {
  ...lightEditorTheme,
  activeBlockBackground: "rgba(16, 185, 129, 0.14)",
  activeBlockFlash: "rgba(16, 185, 129, 0.26)",
  blockquoteRuleActive: "rgba(6, 95, 70, 0.38)",
  blockquoteRule: "rgba(5, 150, 105, 0.22)",
  caret: "#14532d",
  codeBackground: "#052e16",
  codeText: "#dcfce7",
  commentHighlight: "rgba(52, 211, 153, 0.26)",
  commentHighlightActive: "#10b981",
  commentHighlightResolved: "rgba(187, 247, 208, 0.96)",
  commentHighlightResolvedActive: "#059669",
  headingRule: "rgba(20, 83, 45, 0.18)",
  insertHighlightText: "#10b981",
  headingText: "#14532d",
  inlineCodeBackground: "rgba(20, 83, 45, 0.08)",
  inlineCodeText: "#166534",
  leafButtonBackground: "rgba(20, 83, 45, 0.08)",
  leafButtonBorder: "rgba(22, 163, 74, 0.28)",
  leafButtonText: "#14532d",
  leafAccent: "#059669",
  leafBackground: "#f3fbf6",
  leafBorder: "rgba(22, 163, 74, 0.24)",
  leafShadow: "0 14px 40px rgba(20, 83, 45, 0.14)",
  leafSecondaryText: "#166534",
  leafResolvedBackground: "#d1fae5",
  leafResolvedBorder: "#10b981",
  leafText: "#14532d",
  linkText: "#047857",
  paragraphText: "#14532d",
  blockquoteText: "#166534",
  selectionBackground: "rgba(52, 211, 153, 0.24)",
  selectionHandleBackground: "#f3fbf6",
  selectionHandleBorder: "#059669",
  background: "#f3fbf6",
  tableBodyBackground: "rgba(243, 251, 246, 0.96)",
  tableBorder: "rgba(22, 163, 74, 0.24)",
  tableHeaderBackground: "rgba(220, 252, 231, 0.96)",
};

export const midnightEditorTheme: EditorTheme = {
  ...darkEditorTheme,
  activeBlockBackground: "rgba(168, 85, 247, 0.16)",
  activeBlockFlash: "rgba(243, 232, 255, 0.13)",
  blockquoteRuleActive: "rgba(216, 180, 254, 0.44)",
  blockquoteRule: "rgba(196, 181, 253, 0.34)",
  caret: "#f5f3ff",
  codeBackground: "#1e1b4b",
  codeText: "#ede9fe",
  commentHighlight: "rgba(167, 139, 250, 0.28)",
  commentHighlightActive: "#c084fc",
  commentHighlightResolved: "rgba(45, 212, 191, 0.22)",
  commentHighlightResolvedActive: "#2dd4bf",
  headingRule: "rgba(233, 213, 255, 0.24)",
  insertHighlightText: "#c084fc",
  headingText: "#f5f3ff",
  imageSurfaceBackground: "rgba(17, 24, 39, 0.94)",
  imageSurfaceBorder: "rgba(167, 139, 250, 0.28)",
  imagePlaceholderIcon: "rgba(216, 180, 254, 0.42)",
  imagePlaceholderText: "rgba(233, 213, 255, 0.66)",
  imageLoadingOverlay: "rgba(196, 181, 253, 0.12)",
  inlineCodeBackground: "rgba(167, 139, 250, 0.14)",
  inlineCodeText: "#e9d5ff",
  leafButtonBackground: "rgba(167, 139, 250, 0.14)",
  leafButtonBorder: "rgba(167, 139, 250, 0.36)",
  leafButtonText: "#f5f3ff",
  leafAccent: "#c084fc",
  leafBackground: "#111827",
  leafBorder: "rgba(167, 139, 250, 0.34)",
  leafShadow: "0 18px 44px rgba(3, 7, 18, 0.44), 0 0 0 1px rgba(196, 181, 253, 0.08)",
  leafSecondaryText: "#ddd6fe",
  leafResolvedBackground: "rgba(45, 212, 191, 0.22)",
  leafResolvedBorder: "#2dd4bf",
  leafText: "#f5f3ff",
  linkText: "#c4b5fd",
  listMarkerText: "#f5f3ff",
  paragraphText: "#e9d5ff",
  blockquoteText: "#ddd6fe",
  selectionBackground: "rgba(167, 139, 250, 0.26)",
  selectionHandleBackground: "#111827",
  selectionHandleBorder: "#c084fc",
  background: "#111827",
  tableBodyBackground: "rgba(17, 24, 39, 0.92)",
  tableBorder: "rgba(167, 139, 250, 0.34)",
  tableHeaderBackground: "rgba(30, 27, 75, 0.96)",
};
