import {
  getCommentThreadUpdatedAt,
  isResolvedCommentThread,
  type CommentThread,
  type Mark,
} from "@/document";
import {
  Bold,
  Check,
  Italic,
  MessageSquarePlus,
  Pencil,
  Strikethrough,
  Trash2,
  Underline,
} from "lucide-react";
import { useEffect, useRef, useState, type RefObject } from "react";
import { LeafInput, type CompletionSource } from "./core/LeafInput";
import { LeafOutput } from "./core/LeafOutput";
import { LeafToolbar } from "./toolbar/LeafToolbar";

type AnnotationLink = {
  title: string | null;
  url: string;
};

type AnnotationLeafBaseProps = {
  canEdit: boolean;
  link: AnnotationLink | null;
  mentionSources?: CompletionSource[];
};

type AnnotationCreateLeafProps = AnnotationLeafBaseProps & {
  activeMarks: Mark[];
  mode: "create";
  onCreateThread: (body: string) => void;
  onToggleBold: () => void;
  onToggleItalic: () => void;
  onToggleStrikethrough: () => void;
  onToggleUnderline: () => void;
};

type AnnotationThreadLeafProps = AnnotationLeafBaseProps & {
  mode: "thread";
  animateInitialComment?: boolean;
  onDeleteComment: (commentIndex: number) => void;
  onDeleteThread: () => void;
  onEditComment: (commentIndex: number, body: string) => void;
  onReply: (body: string) => void;
  onToggleResolved: () => void;
  thread: CommentThread;
};

type AnnotationLeafProps = AnnotationCreateLeafProps | AnnotationThreadLeafProps;

const defaultCreateExpanded = false;
const createToThreadTransitionMs = 220;
const noop = () => {};

export function AnnotationLeaf(props: AnnotationLeafProps) {
  const createMode = props.mode === "create";
  const createProps: AnnotationCreateLeafProps | null = props.mode === "create" ? props : null;
  const threadProps: AnnotationThreadLeafProps | null = props.mode === "thread" ? props : null;
  const canEdit = props.canEdit;
  const link = props.link;
  const thread = threadProps?.thread ?? null;
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
  const rootRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const mentionSources = props.mentionSources;
  const threadUpdatedAt = thread ? getCommentThreadUpdatedAt(thread) : null;
  const threadAge = threadUpdatedAt ? formatRelativeTime(threadUpdatedAt) : "";
  const canMutateThread = canEdit && !isResolved;
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
  const activeMarks = createProps?.activeMarks ?? [];
  const toggleBold = createProps?.onToggleBold ?? noop;
  const toggleItalic = createProps?.onToggleItalic ?? noop;
  const toggleStrikethrough = createProps?.onToggleStrikethrough ?? noop;
  const toggleUnderline = createProps?.onToggleUnderline ?? noop;
  const composerPlaceholder = canEdit
    ? createMode
      ? "Add a comment"
      : "Reply to this comment"
    : "Comment editing is disabled";
  const composerValue = createMode ? createDraft : replyDraft;

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
      composerRef={composerRef}
      editDraft={editDraft}
      editingCommentIndex={editingCommentIndex}
      isComposerVisible={showComposer}
      isInitialCommentVisible={isInitialCommentVisible}
      isResolved={isResolved}
      link={link}
      mentionSources={mentionSources}
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
      rootComment={rootComment}
      showRootComment={showRootComment}
      showThreadChrome={showThreadChrome}
      threadAge={threadAge}
      composerPlaceholder={composerPlaceholder}
      composerValue={composerValue}
    />
  ) : null;

  return (
    <div className={contentClassName} ref={rootRef}>
      <div className={showCreateChrome ? "documint-comment-leaf-create-shell" : undefined}>
        {showCreateChrome ? (
          <LeafToolbar>
            <LeafToolbar.Button
              className="documint-comment-leaf-create-button"
              icon={MessageSquarePlus}
              label="Add comment"
              onClick={() => setIsExpanded(true)}
            />
            <LeafToolbar.Divider className="documint-comment-leaf-create-divider" />
            <LeafToolbar.Button
              active={activeMarks.includes("bold")}
              className="documint-comment-leaf-create-mark"
              icon={Bold}
              label="Bold"
              onClick={toggleBold}
            />
            <LeafToolbar.Button
              active={activeMarks.includes("italic")}
              className="documint-comment-leaf-create-mark"
              icon={Italic}
              label="Italic"
              onClick={toggleItalic}
            />
            <LeafToolbar.Button
              active={activeMarks.includes("underline")}
              className="documint-comment-leaf-create-mark"
              icon={Underline}
              label="Underline"
              onClick={toggleUnderline}
            />
            <LeafToolbar.Button
              active={activeMarks.includes("strikethrough")}
              className="documint-comment-leaf-create-mark"
              icon={Strikethrough}
              label="Strikethrough"
              onClick={toggleStrikethrough}
            />
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
  composerRef,
  editDraft,
  editingCommentIndex,
  isComposerVisible,
  isInitialCommentVisible,
  isResolved,
  link,
  mentionSources,
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
  composerRef: RefObject<HTMLTextAreaElement | null>;
  editDraft: string;
  editingCommentIndex: number | null;
  isComposerVisible: boolean;
  isInitialCommentVisible: boolean;
  isResolved: boolean;
  link: AnnotationLink | null;
  mentionSources: CompletionSource[] | undefined;
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
  rootComment: CommentThread["comments"][0] | null;
  showRootComment: boolean;
  showThreadChrome: boolean;
  threadAge: string;
  composerPlaceholder: string;
  composerValue: string;
}) {
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
              <Check size={14} strokeWidth={2.2} />
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
        <div className="documint-comment-leaf-link">
          {link.title ? <div className="documint-link-leaf-title">{link.title}</div> : null}
          <div className="documint-link-leaf-url">{link.url}</div>
        </div>
      ) : null}
      <div className={`documint-comment-thread${showRootComment ? "" : " is-empty"}`}>
        <article
          className={
            showRootComment
              ? `documint-comment-message documint-comment-message-root${isInitialCommentVisible ? " is-visible" : ""}`
              : "documint-comment-message documint-comment-message-root is-hidden"
          }
        >
          {rootComment ? (
            <LeafOutput
              completionSources={mentionSources}
              onEdit={() => onBeginEditingComment(0, rootComment.body)}
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
                  completionSources={mentionSources}
                  onChange={onChangeEditDraft}
                  readOnly={!canEdit}
                  rows={3}
                  value={editDraft}
                />
              ) : (
                <LeafOutput
                  completionSources={mentionSources}
                  onEdit={() => onBeginEditingComment(actualIndex, comment.body)}
                  value={comment.body}
                />
              )}
            </article>
          );
        })}
      </div>
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
          completionSources={mentionSources}
          onChange={mode === "create" ? onChangeCreateDraft : onChangeReplyDraft}
          placeholder={composerPlaceholder}
          readOnly={!canEdit}
          ref={composerRef}
          rows={3}
          value={composerValue}
        />
      </div>
    </>
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
