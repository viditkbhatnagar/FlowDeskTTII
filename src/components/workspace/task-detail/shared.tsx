import type { ComponentType, ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { ResourceStatus } from "./utils";

export function DrawerSection({
  title,
  icon: Icon,
  action,
  children,
}: {
  title: string;
  icon: ComponentType<{ className?: string }>;
  /** Optional control shown at the right of the section heading. */
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-xs font-semibold">
          <Icon className="h-4 w-4 text-muted-foreground" />
          {title}
        </h3>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Detail({
  label,
  value,
  capitalize,
}: {
  label: string;
  value: string;
  capitalize?: boolean;
}) {
  return (
    <div className="min-w-0 rounded-lg border border-border bg-muted/20 px-3 py-2">
      <div className="text-[10px] uppercase text-muted-foreground">{label}</div>
      <div
        className={cn("mt-0.5 truncate text-sm font-medium", capitalize && "capitalize")}
        title={value}
      >
        {value}
      </div>
    </div>
  );
}

/** Loading / error / empty line shared by every section, so none of them can render blank. */
export function SectionState({
  status,
  empty,
  loadingText,
  errorText,
  onRetry,
}: {
  status: ResourceStatus;
  empty: string;
  loadingText: string;
  errorText: string;
  onRetry: () => void;
}) {
  if (status === "loading") {
    return (
      <p className="text-sm text-muted-foreground" role="status">
        {loadingText}
      </p>
    );
  }
  if (status === "error") {
    return (
      <p className="text-sm text-destructive" role="alert">
        {errorText}{" "}
        <button
          type="button"
          onClick={onRetry}
          className="font-medium underline underline-offset-2"
        >
          Try again
        </button>
      </p>
    );
  }
  return <p className="text-sm text-muted-foreground">{empty}</p>;
}

export function Avatar({
  name,
  initials,
  color,
}: {
  name: string;
  initials: string;
  color: string;
}) {
  return (
    <span
      aria-hidden="true"
      title={name}
      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white"
      style={{ background: color }}
    >
      {initials}
    </span>
  );
}
