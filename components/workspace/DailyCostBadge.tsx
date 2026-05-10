"use client";

export interface DailyCostBadgeProps {
  todaySpend: number;
  dailyCap: number;
  resetsAt: string;
}

export function DailyCostBadge(props: DailyCostBadgeProps) {
  if (props.dailyCap <= 0) return null;
  const ratio = props.todaySpend / props.dailyCap;
  const color =
    ratio >= 1
      ? "text-rose-600 border-rose-600/40 bg-rose-500/10"
      : ratio >= 0.8
        ? "text-amber-600 border-amber-600/40 bg-amber-500/10"
        : "text-muted-foreground border-border";
  const title = `$${props.todaySpend.toFixed(2)} of $${props.dailyCap.toFixed(2)} today; resets ${new Date(props.resetsAt).toLocaleString()}`;
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium ${color}`}
    >
      ${props.todaySpend.toFixed(2)} / ${props.dailyCap.toFixed(2)}
    </span>
  );
}
