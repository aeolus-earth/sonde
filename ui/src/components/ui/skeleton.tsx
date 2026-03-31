import { cn } from "@/lib/utils";

export function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("animate-shimmer rounded-[5.5px] bg-surface-raised", className)}
      {...props}
    />
  );
}

export function StatBlockSkeleton() {
  return (
    <div className="rounded-[8px] border border-border bg-surface p-3">
      <Skeleton className="h-6 w-12" />
      <Skeleton className="mt-1.5 h-3 w-20" />
    </div>
  );
}

export function ExperimentRowSkeleton() {
  return (
    <div className="flex items-center gap-3 border-b border-border-subtle px-3 py-2.5">
      <Skeleton className="h-4 w-16" />
      <Skeleton className="h-4 w-14" />
      <Skeleton className="h-4 flex-1" />
      <Skeleton className="h-4 w-24" />
    </div>
  );
}

export function DetailSectionSkeleton() {
  return (
    <div className="rounded-[8px] border border-border bg-surface">
      <div className="border-b border-border px-3 py-2">
        <Skeleton className="h-4 w-24" />
      </div>
      <div className="space-y-2 px-3 py-2">
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-4/5" />
        <Skeleton className="h-3 w-3/5" />
      </div>
    </div>
  );
}

export function ListRowSkeleton() {
  return (
    <div className="flex items-center gap-3 border-b border-border-subtle px-3 py-2.5 last:border-0">
      <Skeleton className="h-4 w-14" />
      <div className="min-w-0 flex-1 space-y-1.5">
        <Skeleton className="h-3.5 w-3/4" />
        <Skeleton className="h-3 w-1/2" />
      </div>
      <Skeleton className="h-4 w-16" />
    </div>
  );
}

export function ActivityRowSkeleton() {
  return (
    <div className="flex items-start gap-2.5 border-b border-border-subtle px-3 py-2 last:border-0">
      <Skeleton className="mt-0.5 h-4 w-4 rounded-full" />
      <div className="min-w-0 flex-1">
        <Skeleton className="h-3.5 w-3/4" />
      </div>
      <Skeleton className="h-3 w-20" />
    </div>
  );
}
