import type { ReactNode } from 'react';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@databricks/appkit-ui/react';
import type { QueryState } from '../data/queries';

interface Props<T> {
  query: QueryState<T>;
  /** Skeleton shaped like the final content. */
  skeleton: ReactNode;
  /** What failed, in the reviewer's words. */
  failed: string;
  emptyTitle: string;
  emptyHint: string;
  children: (rows: T[]) => ReactNode;
}

export function ErrorNote({ title, detail }: { title: string; detail?: string | null }) {
  return (
    <Alert variant="destructive" className="border-attention/40 bg-attention-soft text-ink">
      <AlertTitle>{title}</AlertTitle>
      {detail ? <AlertDescription className="text-ink-muted">{detail}</AlertDescription> : null}
    </Alert>
  );
}

export function EmptyNote({ title, hint }: { title: string; hint: string }) {
  return (
    <Empty className="border border-dashed border-border bg-page/60 p-8">
      <EmptyHeader>
        <EmptyTitle className="text-base font-medium">{title}</EmptyTitle>
        <EmptyDescription>{hint}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

export function QueryBoundary<T>({ query, skeleton, failed, emptyTitle, emptyHint, children }: Props<T>) {
  if (query.loading) return <>{skeleton}</>;
  if (query.error) return <ErrorNote title={failed} detail={query.error} />;
  if (!query.data || query.data.length === 0) return <EmptyNote title={emptyTitle} hint={emptyHint} />;
  return <>{children(query.data)}</>;
}
