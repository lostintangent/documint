export {
  Documint,
  applyDocumintPatch,
  defaultKeybindings,
  darkTheme,
  lightTheme,
  type CommentChange,
  type DocumintAction,
  type DocumintActions,
  type DocumintDecoration,
  type DocumintPatch,
  type DocumintPatchChange,
  type EditorInputKeybinding,
  type DocumintProps,
  type DocumintTheme,
  type ResourceProtocolRecord,
  type ActiveResourceSet,
  type UserMentionEvent,
  lucideResourceIcon,
} from "./component";

export type {
  DocumentResourceIcon,
  DocumentResourceIconNode,
  DocumentResourceVectorIcon,
  DocumentPresence,
  DocumentResourceProtocol,
  DocumentResourceReference,
  DocumentUser,
  DocumintStorage,
  EditorInputCommand,
  EditorTheme,
} from "./types";

export { normalizeResourceProtocol, resolveResourceProtocol } from "./resources";

export type {
  Anchor,
  Block,
  DirectiveBlock,
  Document,
  Image,
  Inline,
  Link,
  Mark,
  Raw,
  RawBlock,
  Resource,
  Text,
} from "./document";

export type { CommentThread, Comment } from "./document";
