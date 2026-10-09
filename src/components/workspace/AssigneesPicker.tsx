import { useId, useState } from "react";
import { Search, UserPlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export interface AssigneeOption {
  id: string;
  name: string;
  initials: string;
  color: string;
  /** Department or title, to tell people apart. */
  detail?: string;
}

/**
 * Who a new task is for: one person, or several (spec of 9 Oct 2026, section
 * E). Several people make a group task where each moves their own part. Laid
 * out like the Create Project member picker: chips for the people chosen and
 * a searchable list with checkboxes.
 */
export function AssigneesPicker({
  id,
  options,
  selected,
  onChange,
  meId,
  invalid,
  describedBy,
}: {
  id: string;
  options: AssigneeOption[];
  /** User ids, in the order they were chosen. */
  selected: string[];
  onChange: (ids: string[]) => void;
  /** The signed-in user, labelled "(you)". */
  meId: string | null;
  invalid?: boolean;
  describedBy?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const listId = useId();
  const byId = new Map(options.map((option) => [option.id, option]));
  const needle = query.trim().toLowerCase();
  const matches = options.filter((option) =>
    `${option.name} ${option.detail ?? ""}`.toLowerCase().includes(needle),
  );
  const nameOf = (option: AssigneeOption) =>
    option.id === meId ? `${option.name} (you)` : option.name;
  const toggle = (personId: string, checked: boolean) =>
    onChange(
      checked
        ? [...selected.filter((item) => item !== personId), personId]
        : selected.filter((item) => item !== personId),
    );

  return (
    <div
      className={cn(
        "flex min-h-10 flex-wrap items-center gap-1.5 rounded-md border border-input bg-background px-2 py-1.5",
        invalid && "border-destructive",
      )}
    >
      {selected.map((personId) => {
        const person = byId.get(personId);
        const label = person ? nameOf(person) : "Unknown person";
        return (
          <span
            key={personId}
            className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border bg-card py-0.5 pl-1 pr-1.5 text-xs"
          >
            <span
              aria-hidden="true"
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9px] font-semibold text-white"
              style={{ background: person?.color }}
            >
              {person?.initials ?? "?"}
            </span>
            <span className="min-w-0 truncate">{label}</span>
            <button
              type="button"
              aria-label={`Remove ${label}`}
              onClick={() => toggle(personId, false)}
              className="rounded-full p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        );
      })}
      <Popover
        open={open}
        onOpenChange={(value) => {
          setOpen(value);
          if (!value) setQuery("");
        }}
      >
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs text-muted-foreground"
            aria-describedby={describedBy}
            aria-invalid={invalid || undefined}
          >
            <UserPlus className="h-3.5 w-3.5" aria-hidden="true" />
            {selected.length ? "Add or change people" : "Choose people"}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[340px] max-w-[calc(100vw-3rem)] p-3">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search people…"
              aria-label="Search people"
              aria-controls={listId}
              className="h-8 pl-8"
            />
          </div>
          <ul id={listId} className="mt-2 max-h-60 space-y-0.5 overflow-y-auto" aria-label="People">
            {matches.map((option) => {
              const checkboxId = `${listId}-${option.id}`;
              return (
                <li key={option.id}>
                  <label
                    htmlFor={checkboxId}
                    className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 hover:bg-accent"
                  >
                    <Checkbox
                      id={checkboxId}
                      checked={selected.includes(option.id)}
                      onCheckedChange={(checked) => toggle(option.id, checked === true)}
                    />
                    <span
                      aria-hidden="true"
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white"
                      style={{ background: option.color }}
                    >
                      {option.initials}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-xs font-medium">{nameOf(option)}</span>
                      {option.detail && (
                        <span className="block truncate text-[10px] text-muted-foreground">
                          {option.detail}
                        </span>
                      )}
                    </span>
                  </label>
                </li>
              );
            })}
            {matches.length === 0 && (
              <li className="px-2 py-4 text-center text-xs text-muted-foreground">
                {options.length ? "No people match." : "No people found yet."}
              </li>
            )}
          </ul>
          <div className="mt-2 flex items-center justify-between border-t border-border pt-2">
            <span className="text-[11px] text-muted-foreground">
              {selected.length} {selected.length === 1 ? "person" : "people"} chosen
            </span>
            <Button type="button" size="sm" onClick={() => setOpen(false)}>
              Done
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
