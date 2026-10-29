import { useId, useState } from "react";
import { Repeat2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useWorkspace, type WorkspaceTask } from "@/lib/workspace-data";
import { todayIn } from "@/lib/today";
import { ConfirmDialog } from "./ConfirmDialog";
import { DrawerSection } from "./shared";

/**
 * A repeating task's schedule, and (29 Oct) a way to end it. A repeat could
 * only be set when the task was made, so a daily task kept coming back with
 * no way to stop it short of the SQL editor. Its creator and admins (the
 * people who may delete the task) can stop it or give it an end date.
 */
export function TaskRepeat({ task, canChange }: { task: WorkspaceTask; canChange: boolean }) {
  const { changeRepeat } = useWorkspace();
  const fieldId = useId();
  const [editing, setEditing] = useState(false);
  const [endDate, setEndDate] = useState(task.recurrence?.endDate ?? "");
  const [saving, setSaving] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);
  if (!task.recurrenceSummary || !task.recurrenceId) return null;
  const recurrenceId = task.recurrenceId;
  const stopped = task.recurrenceActive === false;
  const today = todayIn();

  const saveEnd = async () => {
    if (!endDate) {
      toast.error("Choose the last date a copy should be due.");
      return;
    }
    setSaving(true);
    const ok = await changeRepeat(recurrenceId, { endDate });
    setSaving(false);
    if (ok) {
      setEditing(false);
      toast.success(
        endDate < today ? "Repeat ended: no more copies will be made" : "End date saved",
      );
    }
  };

  return (
    <DrawerSection title="Recurring task" icon={Repeat2}>
      <div className="space-y-2 rounded-md border border-border bg-muted/20 px-3 py-2 text-sm">
        <p className="text-muted-foreground">
          {stopped
            ? `Stopped. It no longer makes new copies. (Was: ${task.recurrenceSummary})`
            : task.recurrenceSummary}
        </p>
        {canChange && !stopped && !editing && (
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setEditing(true)}>
              Change end date
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => setConfirmStop(true)}>
              Stop repeating
            </Button>
          </div>
        )}
        {canChange && !stopped && editing && (
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <label htmlFor={`${fieldId}-end`} className="text-xs font-medium">
                Last due date
              </label>
              <Input
                id={`${fieldId}-end`}
                type="date"
                value={endDate}
                onChange={(event) => setEndDate(event.target.value)}
                className="h-8 w-44"
              />
            </div>
            <Button type="button" size="sm" onClick={() => void saveEnd()} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setEditing(false)}
              disabled={saving}
            >
              Cancel
            </Button>
          </div>
        )}
      </div>
      <ConfirmDialog
        open={confirmStop}
        onOpenChange={setConfirmStop}
        title="Stop repeating this task?"
        description="No new copies will be made. Copies that already exist stay as they are."
        confirmLabel="Stop repeating"
        onConfirm={async () => {
          const ok = await changeRepeat(recurrenceId, { stop: true });
          if (ok) toast.success("This task will not repeat again");
          return ok;
        }}
      />
    </DrawerSection>
  );
}
