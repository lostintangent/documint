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
  type CodeGrammarRule,
  type DocumintDecoration,
  type DocumintStorage,
  type EditorInputCommand,
} from "./component";

export type {
  DocumentPresence,
  DocumentResourceIcon,
  DocumentResourceIconNode,
  DocumentResourceProtocol,
  DocumentResourceReference,
  DocumentResourceVectorIcon,
  DocumentUser,
} from "./editor";

export type {
  ActiveBlockChangedEffectContext,
  CodeTokenKind,
  DocumintEffectHandler,
  DocumintEffects,
  DocumintListMarkerPaintFrame,
  EditorTheme,
  ListItemInsertedEffectContext,
  TextDeletedEffectContext,
  TextInsertedEffectContext,
} from "./renderer";

export { normalizeResourceProtocol, resolveResourceProtocol } from "./document";

export type {
  Anchor,
  Block,
  DirectiveBlock,
  Document,
  DocumentMetadata,
  Image,
  Inline,
  Link,
  Mark,
  MetadataValue,
  Raw,
  RawBlock,
  Resource,
  Text,
} from "./document";

export type { CommentThread, Comment } from "./document";
