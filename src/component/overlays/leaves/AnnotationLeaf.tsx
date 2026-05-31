import {
  getCommentThreadUpdatedAt,
  isResolvedCommentThread,
  type CommentThread,
  type MentionTarget,
} from "@/document";
import {
  deleteSelection,
  toggleMark,
  type EditorPresence,
  type SelectionFormatting,
} from "@/editor";
import type { MarkdownOptions } from "@/markdown";
import {
  Check,
  Clipboard,
  ClipboardPaste,
  Code,
  Copy,
  MessageSquarePlus,
  Pencil,
  RotateCcw,
  Scissors,
  Trash2,
  Type,
} from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from "react";
import type { CompletionSource } from "../../completions/completions";
import type { DocumintAction } from "../../Documint";
import { type DocumintStore, useDocumintStore, useEditorCommand } from "../../store";
import { copySelectionAsMarkdown, pastePlainText } from "../../lib/clipboard";
import { resolvePresenceName } from "../../lib/presence";
import { LeafDivider } from "./core/LeafDivider";
import { LeafInput } from "./core/LeafInput";
import { MarkdownOutput } from "./core/MarkdownOutput";
import { formattingMarkDescriptors, type FormattingMarkDescriptor } from "./formatting";
import { LeafToolbar } from "./toolbar/LeafToolbar";

type AnnotationLink = {
  title: string | null;
  url: string;
};

type AnnotationLeafBaseProps = {
  canEdit: boolean;
  completionSources?: CompletionSource[];
  link: AnnotationLink | null;
};

type AnnotationCreateLeafProps = AnnotationLeafBaseProps & {
  formatting: SelectionFormatting;
  markdownOptions?: MarkdownOptions;
  mode: "create";
  onCreateThread: (body: string) => void;
  actions?: readonly DocumintAction<void>[];
};

type AnnotationThreadLeafProps = AnnotationLeafBaseProps & {
  mode: "thread";
  animateInitialComment?: boolean;
  onDeleteComment: (commentIndex: number) => void;
  onDeleteThread: () => void;
  onEditComment: (commentIndex: number, body: string) => void;
  onReply: (body: string) => void;
  onToggleResolved: () => void;
  presence?: EditorPresence | null;
  thread: CommentThread;
};

type AnnotationLeafProps = AnnotationCreateLeafProps | AnnotationThreadLeafProps;

const defaultCreateExpanded = false;
const createToThreadTransitionMs = 220;
const defaultFormatting: SelectionFormatting = {
  marks: [],
  supported: true,
};
const noop = () => {};

const leadingFormattingMarkButtons = formattingMarkDescriptors.filter(
  (descriptor) => descriptor.group === "leading",
);
const trailingFormattingMarkButtons = formattingMarkDescriptors.filter(
  (descriptor) => descriptor.group === "trailing",
);
const overflowFormattingMarkButtons = [
  { group: "trailing", icon: Code, label: "Code", mark: "code" },
  ...trailingFormattingMarkButtons,
] satisfies readonly FormattingMarkDescriptor[];

export function AnnotationLeaf(props: AnnotationLeafProps) {
  const createMode = props.mode === "create";
  const createProps: AnnotationCreateLeafProps | null = props.mode === "create" ? props : null;
  const threadProps: AnnotationThreadLeafProps | null = props.mode === "thread" ? props : null;
  const canEdit = props.canEdit;
  const link = props.link;
  const thread = threadProps?.thread ?? null;
  const threadId = thread?.id ?? null;
  const comments = thread?.comments ?? [];
  const rootComment = comments[0] ?? null;
  const isResolved = thread ? isResolvedCommentThread(thread) : false;
  const animateInitialComment = threadProps?.animateInitialComment ?? false;
  const [editingCommentIndex, setEditingCommentIndex] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [replyDraft, setReplyDraft] = useState("");
  const [createDraft, setCreateDraft] = useState("");
  const [isInitialCommentVisible, setIsInitialCommentVisible] = useState(!animateInitialComment);
  const [isExpanded, setIsExpanded] = useState(defaultCreateExpanded);
  const [isTransitioningFromCreate, setIsTransitioningFromCreate] = useState(false);
  const [isClipboardCopied, setIsClipboardCopied] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const commentsListRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const clipboardCopiedTimeoutRef = useRef<number | null>(null);
  const hasScrolledThreadRef = useRef(false);
  const scrolledThreadIdRef = useRef<string | null>(null);
  const completionSources = props.completionSources;
  const threadUpdatedAt = thread ? getCommentThreadUpdatedAt(thread) : null;
  const threadAge = threadUpdatedAt ? formatRelativeTime(threadUpdatedAt) : "";
  const canMutateThread = canEdit;
  const canSaveEditedComment = canMutateThread && editDraft.trim().length > 0;
  const canReply = canMutateThread && replyDraft.trim().length > 0;
  const canCreate = canEdit && createDraft.trim().length > 0;
  const showCreateChrome = createMode || isTransitioningFromCreate;
  const showComposer = !createMode || isExpanded;
  const showThreadChrome = !createMode && Boolean(thread);
  const showRootComment = Boolean(rootComment);
  const isExpandedCreateMode = createMode ? isExpanded : true;
  const deleteComment = threadProps?.onDeleteComment ?? noop;
  const deleteThread = threadProps?.onDeleteThread ?? noop;
  const toggleResolved = threadProps?.onToggleResolved ?? noop;
  const formatting = createProps?.formatting ?? defaultFormatting;
  const activeFormattingMarks = formatting.marks;
  const formattingSupported = formatting.supported;
  const store = useDocumintStore();
  const toggleMarkCommand = useEditorCommand(toggleMark);
  const deleteSelectionCommand = useEditorCommand(deleteSelection);
  const pastePlainTextCommand = useEditorCommand(pastePlainText);
  const markdownOptions = createProps?.markdownOptions;
  const actions = createProps?.actions ?? [];
  const hasActiveOverflowFormattingMark = overflowFormattingMarkButtons.some((button) =>
    activeFormattingMarks.includes(button.mark),
  );
  const renderFormattingMarkButton = (button: FormattingMarkDescriptor) => (
    <LeafToolbar.Button
      active={activeFormattingMarks.includes(button.mark)}
      className="documint-comment-leaf-create-mark"
      disabled={!formattingSupported}
      icon={button.icon}
      key={button.mark}
      label={button.label}
      onClick={() => toggleMarkCommand(button.mark)}
    />
  );
  const selectOverflowFormattingMark = (value: string) => {
    const descriptor = overflowFormattingMarkButtons.find((button) => button.mark === value);

    if (!descriptor) {
      return;
    }

    toggleMarkCommand(descriptor.mark);
  };
  const showClipboardCopiedFeedback = () => {
    setIsClipboardCopied(true);

    if (clipboardCopiedTimeoutRef.current !== null) {
      window.clearTimeout(clipboardCopiedTimeoutRef.current);
    }

    clipboardCopiedTimeoutRef.current = window.setTimeout(() => {
      setIsClipboardCopied(false);
      clipboardCopiedTimeoutRef.current = null;
    }, 2000);
  };
  const selectClipboardAction = (value: string) => {
    switch (value) {
      case "copy":
        showClipboardCopiedFeedback();
        void copySelectedTextToClipboard(store);
        break;
      case "cut":
        void cutSelectedTextToClipboard(store, deleteSelectionCommand);
        break;
      case "paste":
        void pasteClipboardText(pastePlainTextCommand, markdownOptions);
        break;
    }
  };
  const composerPlaceholder = canEdit
    ? createMode
      ? "Add a comment"
      : "Reply to this comment"
    : "Comment editing is disabled";
  const composerValue = createMode ? createDraft : replyDraft;

  useEffect(() => {
    return () => {
      if (clipboardCopiedTimeoutRef.current !== null) {
        window.clearTimeout(clipboardCopiedTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (
      editingCommentIndex !== null &&
      (editingCommentIndex < 0 || editingCommentIndex >= comments.length)
    ) {
      setEditingCommentIndex(null);
      setEditDraft("");
    }
  }, [comments.length, editingCommentIndex]);

  useEffect(() => {
    if (!showRootComment || !animateInitialComment) {
      setIsInitialCommentVisible(true);
      return;
    }

    setIsInitialCommentVisible(false);
    const frame = requestAnimationFrame(() => {
      setIsInitialCommentVisible(true);
    });

    return () => {
      cancelAnimationFrame(frame);
    };
  }, [animateInitialComment, rootComment, showRootComment]);

  useEffect(() => {
    if (!threadProps || !animateInitialComment) {
      setIsTransitioningFromCreate(false);
      return;
    }

    setIsTransitioningFromCreate(true);
    const timeoutId = window.setTimeout(() => {
      setIsTransitioningFromCreate(false);
    }, createToThreadTransitionMs);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [animateInitialComment, threadProps]);

  useEffect(() => {
    if (!createMode || !isExpanded || !canEdit) {
      return;
    }

    const frame = requestAnimationFrame(() => {
      composerRef.current?.focus();
    });

    return () => {
      cancelAnimationFrame(frame);
    };
  }, [canEdit, createMode, isExpanded]);

  useLayoutEffect(() => {
    if (!threadId || comments.length === 0) {
      hasScrolledThreadRef.current = false;
      scrolledThreadIdRef.current = null;
      return;
    }

    const commentsList = commentsListRef.current;
    if (!commentsList) {
      return;
    }

    if (scrolledThreadIdRef.current !== threadId) {
      hasScrolledThreadRef.current = false;
      scrolledThreadIdRef.current = threadId;
    }

    commentsList.scrollTo({
      behavior: hasScrolledThreadRef.current ? "smooth" : "auto",
      top: commentsList.scrollHeight,
    });
    hasScrolledThreadRef.current = true;
  }, [comments, threadId]);

  const cancelEditing = () => {
    setEditingCommentIndex(null);
    setEditDraft("");
  };

  const beginEditingComment = (commentIndex: number, body: string) => {
    if (!showThreadChrome || !canMutateThread) {
      return;
    }

    setEditingCommentIndex(commentIndex);
    setEditDraft(body);
  };

  const submitEditedComment = (commentIndex: number) => {
    if (!threadProps) {
      return;
    }

    threadProps.onEditComment(commentIndex, editDraft);
    cancelEditing();
  };

  const submitReply = () => {
    if (!threadProps) {
      return;
    }

    threadProps.onReply(replyDraft);
    setReplyDraft("");
  };

  const submitCreate = () => {
    if (!createProps || !canCreate) {
      return;
    }

    createProps.onCreateThread(createDraft);
    setCreateDraft("");
  };

  const contentClassName = showCreateChrome
    ? `documint-comment-leaf documint-comment-leaf-create${isExpandedCreateMode ? " is-expanded" : ""}`
    : "documint-comment-leaf";
  const shouldRenderBody = showThreadChrome || showRootComment || showComposer;

  const content = shouldRenderBody ? (
    <AnnotationLeafBody
      canCreate={canCreate}
      canEdit={canEdit}
      canMutateThread={canMutateThread}
      canReply={canReply}
      canSaveEditedComment={canSaveEditedComment}
      comments={comments}
      commentsListRef={commentsListRef}
      composerRef={composerRef}
      editDraft={editDraft}
      editingCommentIndex={editingCommentIndex}
      isComposerVisible={showComposer}
      isInitialCommentVisible={isInitialCommentVisible}
      isResolved={isResolved}
      link={link}
      completionSources={completionSources}
      mode={props.mode}
      onBeginEditingComment={beginEditingComment}
      onCancelEditing={cancelEditing}
      onChangeCreateDraft={setCreateDraft}
      onChangeEditDraft={setEditDraft}
      onChangeReplyDraft={setReplyDraft}
      onDeleteComment={deleteComment}
      onDeleteThread={deleteThread}
      onSubmitCreate={submitCreate}
      onSubmitEditedComment={submitEditedComment}
      onSubmitReply={submitReply}
      onToggleResolved={toggleResolved}
      presence={threadProps?.presence ?? null}
      rootComment={rootComment}
      showRootComment={showRootComment}
      showThreadChrome={showThreadChrome}
      threadAge={threadAge}
      composerPlaceholder={composerPlaceholder}
      composerValue={composerValue}
    />
  ) : null;

  return (
    <div className={contentClassName} data-resolved={isResolved ? "true" : undefined} ref={rootRef}>
      <div className={showCreateChrome ? "documint-comment-leaf-create-shell" : undefined}>
        {showCreateChrome ? (
          <LeafToolbar>
            <LeafToolbar.Button
              className="documint-comment-leaf-create-button"
              icon={MessageSquarePlus}
              label="Add comment"
              onClick={() => setIsExpanded(true)}
            />
            <LeafToolbar.Menu
              className="documint-comment-leaf-create-mark"
              icon={isClipboardCopied ? Check : Clipboard}
              label="Clipboard"
              onSelect={selectClipboardAction}
            >
              <LeafToolbar.MenuItem icon={Copy} text="Copy" value="copy" />
              <LeafToolbar.MenuItem icon={Scissors} text="Cut" value="cut" />
              <LeafToolbar.MenuDivider />
              <LeafToolbar.MenuItem icon={ClipboardPaste} text="Paste" value="paste" />
            </LeafToolbar.Menu>
            <LeafToolbar.Divider />
            {leadingFormattingMarkButtons.map(renderFormattingMarkButton)}
            <LeafToolbar.Menu
              active={hasActiveOverflowFormattingMark}
              className="documint-comment-leaf-create-mark"
              icon={Type}
              label="More formatting"
              onSelect={selectOverflowFormattingMark}
            >
              {overflowFormattingMarkButtons.map((button) => (
                <LeafToolbar.MenuItem
                  active={activeFormattingMarks.includes(button.mark)}
                  disabled={!formattingSupported}
                  icon={button.icon}
                  key={button.mark}
                  text={button.label}
                  value={button.mark}
                />
              ))}
            </LeafToolbar.Menu>
            {actions.length > 0
              ? [
                  <LeafToolbar.Divider key="actions-divider" />,
                  ...actions.map((action, index) => {
                    return (
                      <LeafToolbar.Button
                        className="documint-comment-leaf-create-mark"
                        icon={action.icon}
                        key={`${action.label}:${index}`}
                        label={action.label}
                        onClick={() => action.onClick()}
                      />
                    );
                  }),
                ]
              : null}
          </LeafToolbar>
        ) : null}
        <div className={showCreateChrome ? "documint-comment-leaf-create-content" : undefined}>
          {content}
        </div>
      </div>
    </div>
  );
}

function AnnotationLeafBody({
  canCreate,
  canEdit,
  canMutateThread,
  canReply,
  canSaveEditedComment,
  comments,
  commentsListRef,
  composerRef,
  editDraft,
  editingCommentIndex,
  isComposerVisible,
  isInitialCommentVisible,
  isResolved,
  link,
  completionSources,
  mode,
  onBeginEditingComment,
  onCancelEditing,
  onChangeCreateDraft,
  onChangeEditDraft,
  onChangeReplyDraft,
  onDeleteComment,
  onDeleteThread,
  onSubmitCreate,
  onSubmitEditedComment,
  onSubmitReply,
  onToggleResolved,
  presence,
  rootComment,
  showRootComment,
  showThreadChrome,
  threadAge,
  composerPlaceholder,
  composerValue,
}: {
  canCreate: boolean;
  canEdit: boolean;
  canMutateThread: boolean;
  canReply: boolean;
  canSaveEditedComment: boolean;
  comments: CommentThread["comments"];
  commentsListRef: RefObject<HTMLDivElement | null>;
  composerRef: RefObject<HTMLTextAreaElement | null>;
  editDraft: string;
  editingCommentIndex: number | null;
  isComposerVisible: boolean;
  isInitialCommentVisible: boolean;
  isResolved: boolean;
  link: AnnotationLink | null;
  completionSources: CompletionSource[] | undefined;
  mode: AnnotationLeafProps["mode"];
  onBeginEditingComment: (commentIndex: number, body: string) => void;
  onCancelEditing: () => void;
  onChangeCreateDraft: (value: string) => void;
  onChangeEditDraft: (value: string) => void;
  onChangeReplyDraft: (value: string) => void;
  onDeleteComment: (commentIndex: number) => void;
  onDeleteThread: () => void;
  onSubmitCreate: () => void;
  onSubmitEditedComment: (commentIndex: number) => void;
  onSubmitReply: () => void;
  onToggleResolved: () => void;
  presence: EditorPresence | null;
  rootComment: CommentThread["comments"][0] | null;
  showRootComment: boolean;
  showThreadChrome: boolean;
  threadAge: string;
  composerPlaceholder: string;
  composerValue: string;
}) {
  const mentionTargets = useMemo(
    () => resolveMentionTargets(completionSources),
    [completionSources],
  );

  return (
    <>
      {showThreadChrome ? (
        <div className="documint-comment-leaf-header">
          <span className="documint-comment-leaf-age">{threadAge}</span>
          <div className="documint-comment-leaf-actions">
            <button
              className="documint-leaf-action"
              aria-label={isResolved ? "Reopen comment" : "Resolve comment"}
              disabled={!canEdit}
              onClick={onToggleResolved}
              title={isResolved ? "Reopen comment" : "Resolve comment"}
              type="button"
            >
              {isResolved ? (
                <RotateCcw size={14} strokeWidth={2.2} />
              ) : (
                <Check size={14} strokeWidth={2.2} />
              )}
            </button>
            <button
              className="documint-leaf-action documint-leaf-action-danger"
              aria-label="Delete comment thread"
              disabled={!canEdit}
              onClick={onDeleteThread}
              title="Delete comment thread"
              type="button"
            >
              <Trash2 size={14} strokeWidth={2.2} />
            </button>
          </div>
        </div>
      ) : null}
      {showThreadChrome && link ? (
        <>
          <div className="documint-comment-leaf-link">
            {link.title ? <div className="documint-link-leaf-title">{link.title}</div> : null}
            <div className="documint-link-leaf-url">{link.url}</div>
          </div>
          <LeafDivider />
        </>
      ) : null}
      <div
        className={`documint-comment-thread${showRootComment ? "" : " is-empty"}`}
        ref={commentsListRef}
      >
        <article
          className={
            showRootComment
              ? `documint-comment-message documint-comment-message-root${isInitialCommentVisible ? " is-visible" : ""}`
              : "documint-comment-message documint-comment-message-root is-hidden"
          }
        >
          {rootComment ? (
            <MarkdownOutput
              mentionTargets={mentionTargets}
              onDoubleClick={() => onBeginEditingComment(0, rootComment.body)}
              value={rootComment.body}
            />
          ) : null}
        </article>
        {comments.slice(1).map((comment, commentIndex) => {
          const actualIndex = commentIndex + 1;
          const isEditing = editingCommentIndex === actualIndex;

          return (
            <article
              className="documint-comment-message"
              key={`${comment.updatedAt}:${actualIndex}`}
            >
              {!isEditing ? (
                <div className="documint-comment-message-meta">
                  <span>{formatRelativeTime(comment.updatedAt)}</span>
                  {canMutateThread ? (
                    <div className="documint-comment-leaf-actions">
                      <button
                        className="documint-leaf-action"
                        aria-label="Edit comment"
                        disabled={!canMutateThread}
                        onClick={() => {
                          onBeginEditingComment(actualIndex, comment.body);
                        }}
                        title="Edit comment"
                        type="button"
                      >
                        <Pencil size={14} strokeWidth={2.2} />
                      </button>
                      <button
                        className="documint-leaf-action documint-leaf-action-danger"
                        aria-label="Delete comment"
                        disabled={!canMutateThread}
                        onClick={() => onDeleteComment(actualIndex)}
                        title="Delete comment"
                        type="button"
                      >
                        <Trash2 size={14} strokeWidth={2.2} />
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : null}
              {isEditing ? (
                <LeafInput
                  actions={{
                    kind: "edit",
                    onCancel: onCancelEditing,
                    onSave: () => onSubmitEditedComment(actualIndex),
                    saveDisabled: !canSaveEditedComment,
                  }}
                  completionSources={completionSources}
                  onChange={onChangeEditDraft}
                  readOnly={!canEdit}
                  rows={3}
                  value={editDraft}
                />
              ) : (
                <MarkdownOutput
                  mentionTargets={mentionTargets}
                  onDoubleClick={() => onBeginEditingComment(actualIndex, comment.body)}
                  value={comment.body}
                />
              )}
            </article>
          );
        })}
      </div>
      {showThreadChrome ? <LeafDivider /> : null}
      <div
        className={`documint-comment-reply${showThreadChrome ? "" : " is-standalone"}${isComposerVisible ? " is-visible" : ""}`}
      >
        <LeafInput
          actions={
            mode === "create"
              ? {
                  kind: "compose",
                  onSubmit: onSubmitCreate,
                  submitDisabled: !canCreate,
                  submitLabel: "Create comment",
                }
              : {
                  kind: "compose",
                  onSubmit: onSubmitReply,
                  submitDisabled: !canReply,
                  submitLabel: "Reply",
                }
          }
          completionSources={completionSources}
          onChange={mode === "create" ? onChangeCreateDraft : onChangeReplyDraft}
          placeholder={composerPlaceholder}
          readOnly={!canEdit}
          ref={composerRef}
          rows={3}
          value={composerValue}
        />
        {mode === "thread" && presence ? <CommentPresenceStatus presence={presence} /> : null}
      </div>
    </>
  );
}

function resolveMentionTargets(
  completionSources: CompletionSource[] | undefined,
): MentionTarget[] | undefined {
  const source = completionSources?.find((candidate) => candidate.trigger === "@");

  if (!source) {
    return undefined;
  }

  return source.items.flatMap<MentionTarget>((item) =>
    item.id ? [{ name: item.label, userId: item.id }] : [],
  );
}

async function copySelectedTextToClipboard(store: DocumintStore) {
  const markdown = copySelectionAsMarkdown(store.editor.getState());

  if (markdown === null) {
    return;
  }

  try {
    await navigator.clipboard.writeText(markdown);
  } catch {
    // Clipboard access is permission- and secure-context-gated.
  }
}

async function cutSelectedTextToClipboard(
  store: DocumintStore,
  deleteSelectionCommand: () => unknown,
) {
  const markdown = copySelectionAsMarkdown(store.editor.getState());

  if (markdown === null) {
    return;
  }

  try {
    await navigator.clipboard.writeText(markdown);
    deleteSelectionCommand();
  } catch {
    // Keep the selection intact if the browser refuses clipboard access.
  }
}

async function pasteClipboardText(
  pastePlainTextCommand: (text: string, markdownOptions?: MarkdownOptions) => unknown,
  markdownOptions?: MarkdownOptions,
) {
  let text = "";

  try {
    text = await navigator.clipboard.readText();
  } catch {
    // Clipboard reads may be blocked even from a menu tap.
    return;
  }

  if (!text) {
    return;
  }

  pastePlainTextCommand(text, markdownOptions);
}

function CommentPresenceStatus({ presence }: { presence: EditorPresence }) {
  const name = resolvePresenceName(presence);
  const status = presence.status?.trim();

  return (
    <div className="documint-comment-presence">
      <span
        aria-hidden="true"
        className="documint-comment-presence-dot"
        style={
          {
            "--documint-comment-presence-color": presence.color ?? "var(--documint-leaf-accent)",
          } as CSSProperties
        }
      >
        {presence.avatarUrl ? (
          <img
            alt=""
            className="documint-comment-presence-avatar"
            draggable={false}
            src={presence.avatarUrl}
          />
        ) : null}
      </span>
      <span>
        {name} is working on this
        {status ? <span className="documint-comment-presence-status"> ({status})</span> : null}
      </span>
    </div>
  );
}

function formatRelativeTime(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  const diffMs = date.getTime() - Date.now();
  const minuteMs = 60 * 1000;
  const hourMs = 60 * minuteMs;
  const dayMs = 24 * hourMs;
  const weekMs = 7 * dayMs;
  const monthMs = 30 * dayMs;
  const yearMs = 365 * dayMs;
  const formatter = new Intl.RelativeTimeFormat(undefined, {
    numeric: "auto",
  });

  if (Math.abs(diffMs) < minuteMs) {
    return "just now";
  }

  if (Math.abs(diffMs) < hourMs) {
    return formatter.format(Math.round(diffMs / minuteMs), "minute");
  }

  if (Math.abs(diffMs) < dayMs) {
    return formatter.format(Math.round(diffMs / hourMs), "hour");
  }

  if (Math.abs(diffMs) < weekMs) {
    return formatter.format(Math.round(diffMs / dayMs), "day");
  }

  if (Math.abs(diffMs) < yearMs) {
    return formatter.format(Math.round(diffMs / monthMs), "month");
  }

  return formatter.format(Math.round(diffMs / yearMs), "year");
}
