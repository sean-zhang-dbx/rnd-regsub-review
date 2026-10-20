import { Link, useLocation, useNavigate } from 'react-router';
import { Button } from '@databricks/appkit-ui/react';
import { Check, ChevronRight } from 'lucide-react';
import { useReview } from '../data/review';

/*
 * The end-to-end workflow across the top of the app, in the order the demo walks it:
 * the sources are gathered (certified tables and parsed documents), the section is drafted from them, the table is re-delivered and QC
 * finds what it touched, and the reviewer fixes, checks and signs off.
 */

export const DRAFT_FINDING = 'csr-11.4.1-02';

const STEPS = [
  { n: 1, title: 'Sources', sub: 'Structured and unstructured', to: '/sources' },
  { n: 2, title: 'Draft', sub: 'CSR 11.4.1 from Table 14.2.1 v3', to: `/review/${DRAFT_FINDING}?step=draft` },
  { n: 3, title: 'Re-delivery and QC', sub: 'Table 14.2.1 v3 to v4', to: '/' },
  { n: 4, title: 'Review and sign-off', sub: 'Recompute, check, approve', to: `/review/${DRAFT_FINDING}` },
] as const;

function activeStep(pathname: string, search: string): number {
  if (pathname.startsWith('/sources') || pathname.startsWith('/documents')) return 1;
  if (pathname.startsWith('/review/')) return new URLSearchParams(search).get('step') === 'draft' ? 2 : 4;
  return 3;
}

export function Stepper() {
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  const review = useReview();
  const active = activeStep(pathname, search);
  const next = STEPS.find((s) => s.n === active + 1);

  return (
    <nav aria-label="Workflow" className="flex h-12 shrink-0 items-center gap-1 border-b border-line bg-page px-5">
      <ol className="flex min-w-0 flex-1 items-center gap-1">
        {STEPS.map((s, i) => {
          const done = s.n < active || (s.n === 4 && !!review.approved);
          const on = s.n === active;
          return (
            <li key={s.n} className="flex min-w-0 items-center gap-1">
              <Link
                to={s.to}
                aria-current={on ? 'step' : undefined}
                className={`flex min-w-0 items-center gap-2 rounded-[var(--radius)] px-2.5 py-1 ${on ? 'bg-cited-soft' : 'hover:bg-desk'}`}
              >
                <span
                  className={`grid size-6 shrink-0 place-items-center rounded-full text-xs font-semibold ${
                    on ? 'bg-cited text-page' : done ? 'bg-recomputed text-page' : 'border border-line text-ink-muted'
                  }`}
                >
                  {done && !on ? <Check className="size-3.5" aria-label="done" /> : s.n}
                </span>
                <span className="min-w-0 leading-tight">
                  <span className={`block truncate text-[13px] font-semibold ${on ? 'text-cited' : 'text-ink'}`}>{s.title}</span>
                  <span className="hidden truncate text-[11px] text-ink-muted min-[1300px]:block">{s.sub}</span>
                </span>
              </Link>
              {i < STEPS.length - 1 ? <ChevronRight className="size-4 shrink-0 text-line" aria-hidden="true" /> : null}
            </li>
          );
        })}
      </ol>
      {next ? (
        <Button size="sm" variant="outline" className="shrink-0" onClick={() => void navigate(next.to)}>
          Next: {next.title}
          <ChevronRight className="ml-1 size-4" />
        </Button>
      ) : null}
    </nav>
  );
}
