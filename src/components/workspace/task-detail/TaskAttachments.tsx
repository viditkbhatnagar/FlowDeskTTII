import { useEffect, useRef, useState } from "react";
import { ExternalLink, Loader2, Paperclip, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  deleteStoredFile,
  FILE_RULES,
  fileUrl,
  formatBytes,
  listTaskFiles,
  uploadTaskFiles,
  type StoredFile,
} from "@/lib/task-api";
import { useWorkspace, type WorkspaceTask } from "@/lib/workspace-data";
import { ConfirmDialog } from "./ConfirmDialog";
import { DrawerSection, SectionState } from "./shared";
import { fullTime, timeAgo, useTaskResource } from "./utils";

/**
 * Files saved on the task, from storage. The old modal listed the same three
 * made-up files everywhere (FD-005), files attached at creation vanished
 * (FD-058), and nothing showed a size or let you remove one (FD-070).
 */
export function TaskAttachments({
  task,
  onChanged,
}: {
  task: WorkspaceTask;
  onChanged: () => void;
}) {
  const { updateTask } = useWorkspace();
  const files = useTaskResource(() => listTaskFiles(task.id), task.id);
  const [uploading, setUploading] = useState(false);
  const [removing, setRemoving] = useState<StoredFile | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Keep the card's paperclip count in step with what is really stored, without
  // a full reload. updateTask writes nothing to the database for `attachments`;
  // it only updates the task in the shared list.
  const { data: stored, status: storedStatus } = files;
  useEffect(() => {
    if (storedStatus !== "ready" || !stored) return;
    const names = stored.map((file) => file.name);
    const same = [...names].sort().join("\n") === [...task.attachments].sort().join("\n");
    if (!same) void updateTask(task.id, { attachments: names });
    // Runs when the stored list changes, not on every task re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stored, storedStatus]);

  const upload = async (picked: File[]) => {
    if (!picked.length) return;
    if (!task.organizationId) {
      toast.error("This task cannot take files yet. Reload the page and try again.");
      return;
    }
    setUploading(true);
    const result = await uploadTaskFiles(
      { id: task.id, organizationId: task.organizationId },
      picked,
    );
    setUploading(false);
    for (const file of result.rejected) toast.error(`${file.name} ${file.reason}.`);
    if (result.uploaded.length) {
      if (files.data) files.update((current) => [...current, ...result.uploaded]);
      else files.reload();
      onChanged();
      toast.success(
        result.uploaded.length === 1 ? "File attached" : `${result.uploaded.length} files attached`,
      );
    }
  };

  const open = async (file: StoredFile) => {
    // Open the tab synchronously so the popup blocker allows it, then point it
    // at the signed link once we have it.
    const tab = window.open("", "_blank");
    const url = await fileUrl(file);
    if (!url) {
      tab?.close();
      toast.error(`${file.name} could not be opened.`);
      return;
    }
    if (tab) {
      tab.opener = null;
      tab.location.href = url;
    } else {
      window.location.assign(url);
    }
  };

  const remove = async (file: StoredFile): Promise<boolean> => {
    const ok = await deleteStoredFile(file);
    if (!ok) {
      toast.error(`${file.name} could not be removed.`);
      return false;
    }
    files.update((current) => current.filter((item) => item.id !== file.id));
    onChanged();
    toast.success(`${file.name} removed`);
    return true;
  };

  return (
    <DrawerSection
      title="Attachments"
      icon={Paperclip}
      action={
        <>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 gap-1.5 px-2 text-xs"
            disabled={uploading}
            onClick={() => inputRef.current?.click()}
          >
            {uploading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Upload className="h-3.5 w-3.5" />
            )}
            {uploading ? "Uploading…" : "Attach files"}
          </Button>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept={FILE_RULES.accept}
            className="hidden"
            aria-label="Attach files"
            onChange={(event) => {
              const picked = Array.from(event.target.files ?? []);
              // Reset so picking the same file again still fires a change.
              event.target.value = "";
              void upload(picked);
            }}
          />
        </>
      }
    >
      <div className="space-y-2">
        {files.status === "ready" && files.data?.length ? (
          files.data.map((file) => (
            <div
              key={file.id}
              className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm"
            >
              <Paperclip className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium" title={file.name}>
                  {file.name}
                </div>
                <div className="truncate text-[11px] text-muted-foreground">
                  {formatBytes(file.size)} · {file.uploadedBy.name} ·{" "}
                  <time dateTime={file.createdAt} title={fullTime(file.createdAt)}>
                    {timeAgo(file.createdAt)}
                  </time>
                </div>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0 text-muted-foreground"
                aria-label={`Open ${file.name}`}
                title="Open"
                onClick={() => void open(file)}
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </Button>
              {file.isMine && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                  aria-label={`Remove ${file.name}`}
                  title="Remove"
                  onClick={() => setRemoving(file)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          ))
        ) : (
          <SectionState
            status={files.status}
            empty="No attachments."
            loadingText="Loading attachments…"
            errorText="Attachments could not be loaded."
            onRetry={files.reload}
          />
        )}
        <p className="text-[11px] text-muted-foreground">{FILE_RULES.label}.</p>
      </div>
      <ConfirmDialog
        open={Boolean(removing)}
        onOpenChange={(next) => !next && setRemoving(null)}
        title="Remove this file?"
        description={
          removing ? `${removing.name} will be deleted from this task for everyone.` : ""
        }
        confirmLabel="Remove file"
        onConfirm={() => (removing ? remove(removing) : Promise.resolve(true))}
      />
    </DrawerSection>
  );
}
