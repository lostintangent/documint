import { getCommentThreadUpdatedAt, isResolvedCommentThread, type CommentThread } from "@/document";
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
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import type { CompletionSource } from "../../completions/completions";
import type { DocumintAction } from "../../Documint";
import { type DocumintStore, useDocumintStore, useEditorCommand } from "../../store";
import { copySelectionAsMarkdown, pastePlainText } from "../../lib/clipboard";
import { resolveMentionTargets } from "../../lib/mentions";
import { resolvePresenceName } from "../../lib/presence";
import { LeafButton } from "./core/LeafButton";
import { LeafDivider } from "./core/LeafDivider";
import { LeafInput } from "./core/input/LeafInput";
import { LeafMarkdown } from "./core/LeafMarkdown";
import { clx } from "./core/lib/clx";
import { formattingMarkDescriptors, type FormattingMarkDescriptor } from "./core/lib/formatting";
import { LeafToolbar } from "./core/toolbar/LeafToolbar";

type AnnotationLink = {
  title: string | null;
  url: string;
};

type AnnotationLeafBaseProps = {
  canMutateComments: boolean;
  completionSources?: CompletionSource[];
  link: AnnotationLink | null;
  readOnly: boolean;
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

const createToThreadTransitionMs = 220;
const defaultFormatting: SelectionFormatting = {
  marks: [],
  supported: true,
};
const noop = () => {};

// A comment row: the thread header, a reply's meta line, and their action groups.
const ROW_CLASS = "flex justify-between items-center gap-2";
const MESSAGE_CLASS =
  "grid gap-[0.55rem] not-last:pb-3 not-last:border-b not-last:border-b-leaf-divider";

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
  const canMutateComments = props.canMutateComments;
  const link = props.link;
  const readOnly = props.readOnly;
  const thread = threadProps?.thread ?? null;
  const threadId = thread?.id ?? null;
  const threadComments = thread?.comments;
  const commentCount = threadComments?.length ?? 0;
  const rootComment = threadComments?.[0] ?? null;
  const isResolved = thread ? isResolvedCommentThread(thread) : false;
  const animateInitialComment = threadProps?.animateInitialComment ?? false;
  const presence = threadProps?.presence ?? null;
  const [editingCommentIndex, setEditingCommentIndex] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [replyDraft, setReplyDraft] = useState("");
  const [createDraft, setCreateDraft] = useState("");
  const [isExpanded, setIsExpanded] = useState(false);
  const [wasCreateMode, setWasCreateMode] = useState(createMode);
  const [isTransitioningFromCreate, setIsTransitioningFromCreate] = useState(false);
  const commentsListRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  // The thread the comment list was last scrolled for: its first scroll
  // jumps, and later scrolls for the same thread animate.
  const scrolledThreadIdRef = useRef<string | null>(null);
  const completionSources = props.completionSources;
  const mentionTargets = resolveMentionTargets(completionSources);
  const threadUpdatedAt = thread ? getCommentThreadUpdatedAt(thread) : null;
  const threadAge = threadUpdatedAt ? formatRelativeTime(threadUpdatedAt) : "";
  const canSaveEditedComment = canMutateComments && editDraft.trim().length > 0;
  const canReply = canMutateComments && replyDraft.trim().length > 0;
  const canCreate = canMutateComments && createDraft.trim().length > 0;
  const showCreateChrome = createMode || isTransitioningFromCreate;
  const showComposer = !createMode || isExpanded;
  const showRootComment = Boolean(rootComment);
  const deleteComment = threadProps?.onDeleteComment ?? noop;
  const deleteThread = threadProps?.onDeleteThread ?? noop;
  const toggleResolved = threadProps?.onToggleResolved ?? noop;
  const composerPlaceholder = canMutateComments
    ? createMode
      ? "Add a comment"
      : "Reply to this comment"
    : "Comment editing is disabled";
  const composerValue = createMode ? createDraft : replyDraft;

  if (
    editingCommentIndex !== null &&
    (editingCommentIndex < 0 || editingCommentIndex >= commentCount)
  ) {
    setEditingCommentIndex(null);
    setEditDraft("");
  }

  // The leaf stays mounted across mode changes, so collapse the composer
  // to keep the next selection on the toolbar.
  if (wasCreateMode !== createMode) {
    setWasCreateMode(createMode);
    setIsTransitioningFromCreate(wasCreateMode && animateInitialComment);
    setIsExpanded(false);
  }

  useEffect(() => {
    if (!isTransitioningFromCreate) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setIsTransitioningFromCreate(false);
    }, createToThreadTransitionMs);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [isTransitioningFromCreate]);

  useEffect(() => {
    if (!createMode || !isExpanded || !canMutateComments) {
      return;
    }

    const frame = requestAnimationFrame(() => {
      composerRef.current?.focus();
    });

    return () => {
      cancelAnimationFrame(frame);
    };
  }, [canMutateComments, createMode, isExpanded]);

  useLayoutEffect(() => {
    if (!threadId || !threadComments?.length) {
      scrolledThreadIdRef.current = null;
      return;
    }

    const commentsList = commentsListRef.current;
    if (!commentsList) {
      return;
    }

    commentsList.scrollTo({
      behavior: scrolledThreadIdRef.current === threadId ? "smooth" : "auto",
      top: commentsList.scrollHeight,
    });
    scrolledThreadIdRef.current = threadId;
  }, [threadComments, threadId]);

  const cancelEditing = () => {
    setEditingCommentIndex(null);
    setEditDraft("");
  };

  const beginEditingComment = (commentIndex: number, body: string) => {
    if (createMode || !canMutateComments) {
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

  const renderCommentBody = (commentIndex: number, body: string) =>
    editingCommentIndex === commentIndex ? (
      <LeafInput
        actions={{
          kind: "edit",
          onCancel: cancelEditing,
          onSave: () => submitEditedComment(commentIndex),
          saveDisabled: !canSaveEditedComment,
        }}
        completionSources={completionSources}
        onChange={setEditDraft}
        readOnly={!canMutateComments}
        value={editDraft}
      />
    ) : (
      <LeafMarkdown
        mentionTargets={mentionTargets}
        onDoubleClick={() => beginEditingComment(commentIndex, body)}
        value={body}
      />
    );

  // Thread mode and the expanded composer get the comment width and padding;
  // the collapsed create chrome renders only a `LeafToolbar`, so it lets the
  // toolbar own all the spacing (otherwise the two would stack).
  const contentClassName = clx(
    showCreateChrome && "comment-leaf-create",
    showCreateChrome && showComposer && "is-expanded",
    showComposer && "w-[min(18rem,calc(100vw-4rem))] p-3",
  );

  // Create and thread modes share one body tree, so the create → thread morph
  // keeps the composer mounted while the new root comment animates in.
  return (
    <div className={contentClassName}>
      <div className={showCreateChrome ? "comment-leaf-create-shell" : undefined}>
        {showCreateChrome ? (
          <AnnotationCreateToolbar
            actions={createProps?.actions}
            canMutateComments={canMutateComments}
            formatting={createProps?.formatting ?? defaultFormatting}
            markdownOptions={createProps?.markdownOptions}
            onAddComment={() => setIsExpanded(true)}
            readOnly={readOnly}
          />
        ) : null}
        <div className={showCreateChrome ? "comment-leaf-create-content" : undefined}>
          {showComposer ? (
            <>
              {!createMode ? (
                <div className={clx(ROW_CLASS, "mb-[0.7rem]")}>
                  <span className="text-leaf-secondary text-[0.76rem] italic">{threadAge}</span>
                  <div className={ROW_CLASS}>
                    <LeafButton
                      disabled={!canMutateComments}
                      icon={isResolved ? RotateCcw : Check}
                      onClick={toggleResolved}
                      title={isResolved ? "Reopen comment" : "Resolve comment"}
                    />
                    <LeafButton
                      danger
                      disabled={!canMutateComments}
                      icon={Trash2}
                      onClick={deleteThread}
                      title="Delete comment thread"
                    />
                  </div>
                </div>
              ) : null}
              {!createMode && link ? (
                <>
                  <div className="grid gap-[0.3rem]">
                    {link.title ? (
                      <div className="text-leaf-text text-xs font-semibold">{link.title}</div>
                    ) : null}
                    <div className="min-w-0 text-leaf-secondary text-xs wrap-anywhere">
                      {link.url}
                    </div>
                  </div>
                  <LeafDivider />
                </>
              ) : null}
              <div
                className={clx(
                  "grid gap-3",
                  showRootComment
                    ? "max-h-64 mb-[0.8rem] overflow-auto"
                    : "max-h-0 overflow-hidden",
                )}
                ref={commentsListRef}
              >
                <article
                  className={clx(
                    MESSAGE_CLASS,
                    "origin-top-left",
                    showRootComment
                      ? animateInitialComment && "motion-safe:animate-comment-root-enter"
                      : "max-h-0 overflow-hidden",
                  )}
                >
                  {rootComment ? renderCommentBody(0, rootComment.body) : null}
                </article>
                {threadComments?.slice(1).map((comment, commentIndex) => {
                  const actualIndex = commentIndex + 1;
                  const isEditing = editingCommentIndex === actualIndex;

                  return (
                    <article className={MESSAGE_CLASS} key={`${comment.updatedAt}:${actualIndex}`}>
                      {!isEditing ? (
                        <div className={ROW_CLASS}>
                          <span className="text-leaf-secondary text-[0.74rem] italic">
                            {formatRelativeTime(comment.updatedAt)}
                          </span>
                          {canMutateComments ? (
                            <div className={ROW_CLASS}>
                              <LeafButton
                                icon={Pencil}
                                onClick={() => {
                                  beginEditingComment(actualIndex, comment.body);
                                }}
                                title="Edit comment"
                              />
                              <LeafButton
                                danger
                                icon={Trash2}
                                onClick={() => deleteComment(actualIndex)}
                                title="Delete comment"
                              />
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                      {renderCommentBody(actualIndex, comment.body)}
                    </article>
                  );
                })}
              </div>
              {!createMode ? <LeafDivider /> : null}
              <div className={clx("relative", !createMode && "pt-[0.85rem]")}>
                <LeafInput
                  actions={
                    createMode
                      ? {
                          kind: "compose",
                          onSubmit: submitCreate,
                          submitDisabled: !canCreate,
                          submitLabel: "Create comment",
                        }
                      : {
                          kind: "compose",
                          onSubmit: submitReply,
                          submitDisabled: !canReply,
                          submitLabel: "Reply",
                        }
                  }
                  completionSources={completionSources}
                  onChange={createMode ? setCreateDraft : setReplyDraft}
                  placeholder={composerPlaceholder}
                  readOnly={!canMutateComments}
                  ref={composerRef}
                  value={composerValue}
                />
                {!createMode && presence ? (
                  <CommentPresenceStatus isResolved={isResolved} presence={presence} />
                ) : null}
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// Create mode's selection toolbar: clipboard, formatting, host actions, and
// the button that expands the comment composer.
function AnnotationCreateToolbar({
  actions = [],
  canMutateComments,
  formatting,
  markdownOptions,
  onAddComment,
  readOnly,
}: {
  actions?: readonly DocumintAction<void>[];
  canMutateComments: boolean;
  formatting: SelectionFormatting;
  markdownOptions?: MarkdownOptions;
  onAddComment: () => void;
  readOnly: boolean;
}) {
  const [isClipboardCopied, setIsClipboardCopied] = useState(false);
  const clipboardCopiedTimeoutRef = useRef<number | null>(null);
  const store = useDocumintStore();
  const toggleMarkCommand = useEditorCommand(toggleMark);
  const deleteSelectionCommand = useEditorCommand(deleteSelection);
  const pastePlainTextCommand = useEditorCommand(pastePlainText);
  const activeFormattingMarks = formatting.marks;
  const formattingSupported = formatting.supported;
  const hasActiveOverflowFormattingMark = overflowFormattingMarkButtons.some((button) =>
    activeFormattingMarks.includes(button.mark),
  );
  const renderFormattingMarkButton = (button: FormattingMarkDescriptor) => (
    <LeafToolbar.Button
      active={activeFormattingMarks.includes(button.mark)}
      disabled={readOnly || !formattingSupported}
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
        void writeSelectionToClipboard(store);
        break;
      case "cut":
        void writeSelectionToClipboard(store).then((written) => {
          if (written) deleteSelectionCommand();
        });
        break;
      case "paste":
        void pasteClipboardText(pastePlainTextCommand, markdownOptions);
        break;
    }
  };

  useEffect(() => {
    return () => {
      if (clipboardCopiedTimeoutRef.current !== null) {
        window.clearTimeout(clipboardCopiedTimeoutRef.current);
      }
    };
  }, []);

  return (
    <div className="comment-leaf-create-toolbar">
      <LeafToolbar>
        {canMutateComments ? (
          <LeafToolbar.Button icon={MessageSquarePlus} label="Add comment" onClick={onAddComment} />
        ) : null}
        <LeafToolbar.Menu
          icon={isClipboardCopied ? Check : Clipboard}
          label="Clipboard"
          onSelect={selectClipboardAction}
        >
          <LeafToolbar.MenuItem icon={Copy} text="Copy" value="copy" />
          <LeafToolbar.MenuItem disabled={readOnly} icon={Scissors} text="Cut" value="cut" />
          <LeafToolbar.MenuDivider />
          <LeafToolbar.MenuItem
            disabled={readOnly}
            icon={ClipboardPaste}
            text="Paste"
            value="paste"
          />
        </LeafToolbar.Menu>
        <LeafToolbar.Divider />
        {leadingFormattingMarkButtons.map(renderFormattingMarkButton)}
        <LeafToolbar.Menu
          active={hasActiveOverflowFormattingMark}
          disabled={readOnly || !formattingSupported}
          icon={Type}
          label="More formatting"
          onSelect={selectOverflowFormattingMark}
        >
          {overflowFormattingMarkButtons.map((button) => (
            <LeafToolbar.MenuItem
              active={activeFormattingMarks.includes(button.mark)}
              disabled={readOnly || !formattingSupported}
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
    </div>
  );
}

// Resolves whether the selection's markdown reached the clipboard, so cut
// keeps the selection intact when there is nothing to copy or access is denied.
async function writeSelectionToClipboard(store: DocumintStore) {
  const markdown = copySelectionAsMarkdown(store.editor.getState());

  if (markdown === null) {
    return false;
  }

  try {
    await navigator.clipboard.writeText(markdown);
    return true;
  } catch {
    // Clipboard access is permission- and secure-context-gated.
    return false;
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

function CommentPresenceStatus({
  isResolved,
  presence,
}: {
  isResolved: boolean;
  presence: EditorPresence;
}) {
  const name = resolvePresenceName(presence);
  const status = presence.status?.trim();

  return (
    <div className="flex items-center gap-[0.45rem] mt-[0.55rem] text-leaf-secondary text-[0.74rem] leading-[1.2]">
      <span
        aria-hidden="true"
        className={clx(
          "comment-presence-dot",
          "relative isolate inline-grid place-items-center flex-none size-[0.72rem] rounded-full bg-(--presence-color)",
          !isResolved && "is-pulsing",
        )}
        style={
          {
            "--presence-color": presence.color ?? "var(--documint-leaf-accent)",
          } as CSSProperties
        }
      >
        {presence.avatarUrl ? (
          <img
            alt=""
            className="relative z-1 w-full h-full rounded-[inherit] object-cover"
            draggable={false}
            src={presence.avatarUrl}
          />
        ) : null}
      </span>
      <span>
        {name} is working on this
        {status ? <span className="italic"> ({status})</span> : null}
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
