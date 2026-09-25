import { Building2, ChevronDown, Check } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { useOrganizations } from "@/lib/organizations-data";

export function OrgSwitcher() {
  const { accessibleOrganizations, activeOrgId, setActiveOrgId } = useOrganizations();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  // Users with access to a single organization do not need a switcher.
  if (accessibleOrganizations.length <= 1) return null;

  const active = accessibleOrganizations.find((o) => o.id === activeOrgId);
  const label = active ? active.name : "All Organizations";

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-2 text-xs font-medium transition hover:bg-accent"
        aria-label={`Switch organization (current: ${label})`}
        aria-expanded={open}
        aria-controls="org-switcher-options"
      >
        <Building2 className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
        <span className="hidden max-w-[140px] truncate sm:inline">{label}</span>
        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden="true" />
          <div id="org-switcher-options" className="absolute left-0 z-50 mt-2 w-60 rounded-xl border border-border bg-card p-1.5 shadow-[var(--shadow-card)]">
            {[{ id: "all" as const, name: "All Organizations", status: "active" as const }, ...accessibleOrganizations].map(
              (org) => (
                <button
                  key={org.id}
                  type="button"
                  aria-pressed={activeOrgId === org.id}
                  onClick={() => {
                    setActiveOrgId(org.id);
                    setOpen(false);
                  }}
                  className={cn(
                    "flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-xs transition hover:bg-accent",
                    activeOrgId === org.id && "text-primary",
                  )}
                >
                  <span className="flex items-center gap-2 truncate">
                    <span className="truncate">{org.name}</span>
                    {org.status === "inactive" && (
                      <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        Inactive
                      </span>
                    )}
                  </span>
                  {activeOrgId === org.id && <Check className="h-3.5 w-3.5" aria-hidden="true" />}
                </button>
              ),
            )}
          </div>
        </>
      )}
    </div>
  );
}
