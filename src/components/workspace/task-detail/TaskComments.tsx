import { useEffect, useId, useState } from "react";
import { Loader2, MessageSquare, Send, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  addComment,
  COMMENT_MAX_LENGTH,
  deleteComment,
  listComments,
  type TaskComment,
} from "@/lib/task-api";
import { useWorkspace, type WorkspaceTask } from "@/lib/workspace-data";
import { ConfirmDialog } from "./ConfirmDialog";
import { LinkifiedText } from "./LinkifiedText";
import { Avatar, DrawerSection, SectionState } from "./shared";
import { fullTime, timeAgo, useTaskResource } from "./utils";

/**
 * Saved comments. The old composer credited every comment to a demo person
 * and kept it only until the modal closed (FD-007). The author now comes from
 * the session, enforced by the database, and the comment is stored.
 */
export function TaskComments({ task, onChanged }: { task: WorkspaceTask; onChanged: () => void }) {
  const { updateTask } = useWorkspace();
  const comments = useTaskResource(() => listComments(task.id), task.id);
  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);
  const [deleting, setDeleting] = useState<TaskComment | null>(null);
  const composerId = useId();
  const counterId = useId();
  const length = draft.trim().length;
  const tooLong = length > COMMENT_MAX_LENGTH;

  // Keep the card's comment count in step. `comments` is a local-only field for
  // updateTask: nothing is written to the database for it.
  const { data: saved, status: savedStatus } = comments;
  useEffect(() => {
    if (savedStatus !== "ready" || !saved || saved.length === task.comments) return;
    void updateTask(task.id, { comments: saved.length });
    // Runs when the saved list changes, not on every task re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saved, savedStatus]);

  const post = async () => {
    if (!length || tooLong || posting) return;
    setPosting(true);
    const comment = await addComment(task.id, draft);
    setPosting(false);
    if (!comment) {
      toast.error("Your comment could not be saved. Try again.");
      return;
    }
    setDraft("");
    if (comments.data) comments.update((current) => [...current, comment]);
    else comments.reload();
    onChanged();
  };

  const remove = async (comment: TaskComment): Promise<boolean> => {
    const ok = await deleteComment(comment.id);
    if (!ok) {
      toast.error("The comment could not be deleted.");
      return false;
    }
    comments.update((current) => current.filter((item) => item.id !== comment.id));
    onChanged();
    return true;
  };

  return (
    <DrawerSection title="Comments" icon={MessageSquare}>
      <div className="space-y-2.5">
        {comments.status === "ready" && comments.data?.length ? (
          <ul className="space-y-2.5">
            {comments.data.map((comment) => (
              <li key={comment.id} className="flex gap-2">
                <Avatar {...comment.author} />
                <div className="min-w-0 flex-1 rounded-lg border border-border bg-muted/20 px-2.5 py-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-xs font-medium">{comment.author.name}</span>
                    <div className="flex shrink-0 items-center gap-1">
                      <time
                        dateTime={comment.createdAt}
                        title={fullTime(comment.createdAt)}
                        className="text-[10px] text-muted-foreground"
                      >
                        {timeAgo(comment.createdAt)}
                      </time>
                      {comment.isMine && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 text-muted-foreground hover:text-destructive"
                          aria-label="Delete comment"
                          title="Delete comment"
                          onClick={() => setDeleting(comment)}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      )}
                    </div>
                  </div>
                  <LinkifiedText text={comment.body} className="mt-0.5 text-sm" />
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <SectionState
            status={comments.status}
            empty="No comments yet."
            loadingText="Loading comments…"
            errorText="Comments could not be loaded."
            onRetry={comments.reload}
          />
        )}
        <div className="flex items-end gap-2">
          <label htmlFor={composerId} className="sr-only">
            Write a comment
          </label>
          <Textarea
            id={composerId}
            value={draft}
            rows={2}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              // Enter posts; Shift+Enter starts a new line.
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                void post();
              }
            }}
            placeholder="Write a comment…"
            aria-describedby={counterId}
            aria-invalid={tooLong || undefined}
            className="min-h-[2.5rem] resize-y text-sm"
          />
          <Button
            type="button"
            size="icon"
            className="h-9 w-9 shrink-0"
            aria-label="Post comment"
            disabled={!length || tooLong || posting}
            onClick={() => void post()}
          >
            {posting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </div>
        <p
          id={counterId}
          className={tooLong ? "text-xs text-destructive" : "text-[11px] text-muted-foreground"}
        >
          {tooLong
            ? `Comments can be at most ${COMMENT_MAX_LENGTH.toLocaleString()} characters (this one is ${length.toLocaleString()}).`
            : "Enter to post · Shift+Enter for a new line"}
        </p>
      </div>
      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(next) => !next && setDeleting(null)}
        title="Delete this comment?"
        description="The comment will be removed for everyone. This cannot be undone."
        confirmLabel="Delete comment"
        onConfirm={() => (deleting ? remove(deleting) : Promise.resolve(true))}
      />
    </DrawerSection>
  );
}
