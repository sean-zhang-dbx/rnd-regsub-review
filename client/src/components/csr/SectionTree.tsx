import { cn } from '../../lib/utils';
import { AGENT_LABEL, SECTION_STATUS_LABEL, SECTION_STATUS_PILL } from './model';
import type { LiveSectionStatus } from './model';

export type TreeRow = { section: string; title: string; ord: number; agent: string; status: LiveSectionStatus };

export function SectionTree({ rows, selected, onSelect }: { rows: TreeRow[]; selected: string | null; onSelect: (s: string) => void }) {
  return (
    <nav aria-label="CSR sections" className="h-full overflow-y-auto">
      <ul className="divide-y divide-line">
        {rows.map((r) => {
          const sub = r.section.includes('.') ? (r.section.split('.').length > 2 ? 'pl-4' : 'pl-3') : 'pl-3';
          return (
            <li key={r.section}>
              <button
                type="button"
                onClick={() => onSelect(r.section)}
                aria-current={selected === r.section ? 'true' : undefined}
                className={cn('block w-full py-2 pr-3 text-left hover:bg-desk', sub, selected === r.section && 'bg-cited-soft')}
              >
                <span className="flex items-baseline gap-2">
                  <span className="w-12 shrink-0 text-[12px] font-semibold text-ink-muted">{r.section}</span>
                  <span className="min-w-0 flex-1 text-[13px] leading-snug text-ink">{r.title}</span>
                </span>
                <span className="mt-1 flex items-center gap-2 pl-14">
                  <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-px text-[10.5px] font-medium whitespace-nowrap', SECTION_STATUS_PILL[r.status])}>
                    {r.status === 'drafting' ? <span className="size-1.5 animate-pulse rounded-full bg-cited" /> : null}
                    {SECTION_STATUS_LABEL[r.status]}
                  </span>
                  <span className="truncate text-[10.5px] text-ink-muted">{AGENT_LABEL[r.agent] ?? r.agent}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
