import type { Anchor } from "@/document";

export type DocumentImageResource = {
  intrinsicHeight: number;
  intrinsicWidth: number;
  source: ImageBitmap | null;
  status: "error" | "loaded" | "loading";
};

export type DocumentResources = {
  images: Map<string, DocumentImageResource>;
  resourceRegistry: DocumentResourceRegistry;
};

export type DocumentResourceProtocol = {
  icon?: DocumentResourceIcon;
  label: string;
};

export type DocumentResourceIcon = string | DocumentResourceVectorIcon;

export type DocumentResourceVectorIcon = {
  node: DocumentResourceIconNode;
  type: "svg";
};

export type DocumentResourceIconNode = readonly DocumentResourceIconNodeElement[];

export type DocumentResourceIconNodeElement = readonly [
  elementName: string,
  attrs: Readonly<Record<string, string>>,
];

export type DocumentResourceReference = {
  protocol: string;
  url: string;
};

export type DocumentResourceRegistry = {
  active: ReadonlySet<string>;
  protocols: ReadonlyMap<string, DocumentResourceProtocol>;
};

// Host-provided storage for reading/writing resources needed by the document.
//
// `readFile` is invoked when the document references a non-remote URL (i.e.
// anything that isn't `http(s):`, `data:`, or `blob:`); the host returns the
// bytes as a Blob, or `null` to signal "not found" (rendered as an error
// placeholder). The path is whatever string appears in the markdown — relative
// (`./food.png`), absolute (`file:///…`), or a custom scheme — and is opaque
// to the component.
//
// `writeFile` is invoked when content is pasted into the document (currently
// images): the component hands over the pasted file and the host persists it,
// returning a path string that will round-trip back through `readFile` on the
// next render. The host can derive a name, MIME type, and extension from the
// `File` directly.
//
// `openFile` is invoked when the user cmd+clicks a non-remote link. The host
// is responsible for opening the path in the appropriate way (e.g. opening a
// file in the OS, navigating within the app, etc.).
export type DocumintStorage = {
  readFile(path: string): Promise<Blob | null>;
  writeFile(file: File): Promise<string>;
  openFile?(path: string): void;
};

export type EditorInputCommand =
  | "dedent"
  | "deleteBackward"
  | "indent"
  | "insertLineBreak"
  | "insertSoftLineBreak"
  | "moveListItemDown"
  | "moveListItemUp"
  | "moveToDocumentEnd"
  | "moveToDocumentStart"
  | "moveToLineEnd"
  | "moveToLineStart"
  | "redo"
  | "selectAll"
  | "toggleBold"
  | "toggleCode"
  | "toggleItalic"
  | "toggleStrikethrough"
  | "toggleSuperscript"
  | "toggleUnderline"
  | "undo";

export type EditorTheme = {
  activeBlockBackground: string;
  activeBlockFlash: string;
  background: string;
  blockquoteRule: string;
  blockquoteRuleActive: string;
  blockquoteText?: string;
  caret?: string;
  checkboxCheckmark: string;
  checkboxCheckedFill: string;
  checkboxCheckedStroke: string;
  checkboxUncheckedFill: string;
  checkboxUncheckedStroke: string;
  codeBackground: string;
  codeText?: string;
  commentHighlight: string;
  commentHighlightActive: string;
  commentHighlightResolved: string;
  commentHighlightResolvedActive: string;
  dividerRule?: string;
  headingRule: string;
  headingText?: string;
  imageLoadingOverlay: string;
  imagePlaceholderIcon: string;
  imagePlaceholderText?: string;
  imageSurfaceBackground: string;
  imageSurfaceBorder: string;
  inlineCodeBackground: string;
  inlineCodeText?: string;
  insertHighlightText?: string;
  leafAccent: string;
  leafBackground: string;
  leafBorder: string;
  leafInputBackground: string;
  leafButtonText?: string;
  leafResolvedBackground: string;
  leafResolvedBorder: string;
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
  selectionBackground: string;
  selectionHandleBackground: string;
  selectionHandleBorder: string;
  tableBodyBackground: string;
  tableBorder: string;
  tableHeaderBackground: string;
  text: string;
};

export type ResolvedEditorTheme = Required<EditorTheme>;

// --- Users & presence ---
//
// The roster and the live cursor list are separate inputs because they answer
// different questions:
//   - `users` is the roster Documint shows in mention completion (`@`). It
//     includes everyone the host wants mentionable, whether or not they're
//     currently in the document.
//   - `presence` is who's actively in the document right now and what
//     document target they are associated with. Each entry is foreign-keyed
//     to a user via `userId`.
//
// Internally the two are joined into `DocumentUserPresence`, then resolved
// against the document and viewport into `EditorPresence` (in `@/editor`),
// which feeds the canvas (paints remote carets and comment-thread presence
// rules) and the DOM presence overlay (renders scroll-to-cursor arrow buttons
// for off-screen text presences).

/**
 * A user known to the host. The full set is the mention roster; the subset
 * that also appears in `presence` shows a live cursor in the document.
 */
export type DocumentUser = {
  id: string;
  username: string;
  fullName?: string;
  avatarUrl?: string;
};

/**
 * One user's live document presence. `userId` foreign-keys into the `users`
 * roster; entries without a matching user are silently dropped.
 *
 * `cursor` is either a content-addressable text anchor (prefix/suffix) or a
 * comment-thread anchor (`{ threadId }`). The editor resolves comment-thread
 * anchors to a presence-active comment rule instead of a remote caret.
 */
export type DocumentPresence = {
  userId: string;
  cursor?: Anchor;
  color?: string;
};

/**
 * Internal joined shape: a `DocumentUser` denormalized over its
 * `DocumentPresence`. Produced by Documint, consumed by the presence
 * pipeline. Embedders never construct this — they pass `users` and
 * `presence` arrays and Documint joins them by `userId`.
 */
export type DocumentUserPresence = DocumentUser & {
  cursor?: Anchor;
  color?: string;
};
