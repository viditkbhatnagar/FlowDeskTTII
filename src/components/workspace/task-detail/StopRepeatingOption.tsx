import { useId } from "react";
import { Checkbox } from "@/components/ui/checkbox";

/**
 * In a delete confirmation for a repeating task (29 Oct): deleting one copy
 * used to leave its repeat running, so the task "kept reappearing". Ticked by
 * default.
 */
export function StopRepeatingOption({
  checked,
  onCheckedChange,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="flex items-start gap-2 rounded-md border border-border bg-muted/20 px-3 py-2">
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={(value) => onCheckedChange(value === true)}
        className="mt-0.5"
      />
      <label htmlFor={id} className="text-sm leading-snug">
        Also stop repeating
        <span className="block text-xs text-muted-foreground">
          No new copies of this task will be made. Leave unticked to delete only this copy.
        </span>
      </label>
    </div>
  );
}
