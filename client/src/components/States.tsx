import type { ReactNode } from 'react';
import { Button, Empty, EmptyDescription, EmptyHeader, EmptyTitle, Skeleton } from '@databricks/appkit-ui/react';
import { cn } from '@/lib/utils';

/* Loading, empty and error states shared by every data component. */

export function LoadingBlock({ rows = 5, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn('space-y-2', className)} role="status" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-9 w-full" />
      ))}
    </div>
  );
}

export function ErrorBlock({ title, detail, onRetry }: { title: string; detail?: string | null; onRetry?: () => void }) {
  return (
    <div role="alert" className="rounded-panel border border-differs/40 bg-card p-5">
      <p className="text-[15px] font-medium text-differs">{title}</p>
      {detail ? <p className="mt-1 text-[13px] break-words text-muted-foreground">{detail}</p> : null}
      {onRetry ? (
        <Button size="sm" variant="outline" className="mt-3 rounded-control" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}

export function EmptyBlock({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <Empty className="rounded-panel border border-dashed border-border bg-card">
      <EmptyHeader>
        <EmptyTitle>{title}</EmptyTitle>
        {children ? <EmptyDescription>{children}</EmptyDescription> : null}
      </EmptyHeader>
      {action}
    </Empty>
  );
}

/** A panel: white surface, 1px border, no shadow. The marker sits in its top right corner. */
export function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cn('relative rounded-panel border border-border bg-card', className)}>{children}</section>;
}
