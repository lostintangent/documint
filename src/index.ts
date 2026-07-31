import type {} from "./env";

export {
  Documint,
  defaultKeybindings,
  darkTheme,
  lightTheme,
  type CommentChange,
  type DocumintAction,
  type DocumintActions,
  type EditorInputKeybinding,
  type DocumintProps,
  type ResourceProtocolRecord,
  type ActiveResourceSet,
  type UserMentionEvent,
  lucideResourceIcon,
} from "./component";

export type {
  ActiveBlockChangedEffectContext,
  DocumintEffectHandler,
  DocumentResourceIcon,
  DocumentResourceIconNode,
  DocumentResourceVectorIcon,
  DocumentPresence,
  DocumentResourceProtocol,
  DocumentResourceReference,
  DocumentUser,
  DocumintListMarkerPaintFrame,
  DocumintEffects,
  DocumintDecoration,
  DocumintStorage,
  CodeGrammarRule,
  CodeTokenKind,
  EditorInputCommand,
  EditorTheme,
  ListItemInsertedEffectContext,
  TextDeletedEffectContext,
  TextInsertedEffectContext,
} from "./types";

export { normalizeResourceProtocol, resolveResourceProtocol } from "./document";

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
