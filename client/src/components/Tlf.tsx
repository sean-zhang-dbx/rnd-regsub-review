import { useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { TlfCell } from '../data/types';
import { FIG_CELL, STUDY } from '../lib/format';
import { FigureFocus } from './Document';

/* (row, column) of Table 14.2.1 to the figure key the document cites. */
const CELL_FIG: Record<string, string> = Object.fromEntries(
  Object.entries(FIG_CELL).map(([fig, c]) => [`${c.row}:${c.column}`, fig]),
);

interface TlfProps {
  cells: TlfCell[];
  /** Which version of the table the pane shows. */
  version: 3 | 4;
  /** True once the text has been recomputed from version 4, so the text and the table match. */
  matched: boolean;
  animate: boolean;
  /** Figure keys of the finding open in the viewer. */
  currentKeys: Set<string>;
  certified: string;
}

/** Table 14.2.1 as the SAS output page a reviewer ticks and ties against. */
export function TlfPage({ cells, version, matched, animate, currentKeys, certified }: TlfProps) {
  const byCell = new Map(cells.map((c) => [`${c.row_key}:${c.column_name}`, c]));
  let order = 0;
  const cell = (row: string, column: string) => (
    <Cell
      key={`${row}:${column}`}
      c={byCell.get(`${row}:${column}`)}
      fig={CELL_FIG[`${row}:${column}`]}
      version={version}
      matched={matched}
      animate={animate}
      order={order++}
      current={currentKeys.has(CELL_FIG[`${row}:${column}`] ?? '')}
    />
  );

  return (
    <FitWidth width={480}>
    <div className="tlf w-[30rem] bg-page px-6 pt-6 pb-7 text-ink shadow-page">
      <div className="flex justify-between">
        <span>{STUDY}</span>
        <span>Page 1 of 1</span>
      </div>
      <div className="mt-4 text-center">
        <div>Table 14.2.1</div>
        <div>Primary Efficacy Endpoint: Responders at Week 52</div>
        <div>Full Analysis Set</div>
      </div>
      <table className="mt-4 w-full border-collapse">
        <thead>
          <tr className="border-y border-ink align-bottom">
            <th className="py-1.5 text-left font-normal" />
            <th className="py-1.5 text-right font-normal whitespace-nowrap">
              LMN-4471 400 mg
              <br />
              (N={cell('TRT', 'n')})
            </th>
            <th className="py-1.5 pl-4 text-right font-normal whitespace-nowrap">
              Placebo
              <br />
              (N={cell('PBO', 'n')})
            </th>
          </tr>
        </thead>
        <tbody>
          <Row label="Responders, n (%)">
            <>
              {cell('TRT', 'responders')} ({cell('TRT', 'rate_pct')})
            </>
            <>
              {cell('PBO', 'responders')} ({cell('PBO', 'rate_pct')})
            </>
          </Row>
          <tr>
            <td className="pt-3 pr-2">Difference in response rate, percentage points</td>
            <td className="pt-3 text-right align-bottom">{cell('DIFF', 'diff_pct')}</td>
            <td />
          </tr>
          <tr className="border-b border-ink">
            <td className="pb-1.5 pl-4">95% CI (a)</td>
            <td className="pb-1.5 text-right whitespace-nowrap">
              {cell('DIFF', 'ci_low')}, {cell('DIFF', 'ci_high')}
            </td>
            <td />
          </tr>
        </tbody>
      </table>
      <div className="mt-3 space-y-1 text-[11.5px] [&_p]:leading-[1.35]">
        <p>(a) Wald confidence interval for the difference in response rates.</p>
        <p>
          Responder: met the responder definition at Week 52, as adjudicated by the blinded Clinical Endpoint Committee.
        </p>
        <p>
          Source: ADEFF. {certified} Version {version}.
        </p>
      </div>
    </div>
    </FitWidth>
  );
}

/* A SAS output page has a fixed width: scale it down to the pane instead of reflowing it. */
function FitWidth({ width, children }: { width: number; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setZoom(Math.min(1, e.contentRect.width / width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [width]);
  return (
    <div ref={ref} className="w-full">
      <div className="mx-auto w-fit" style={{ zoom }}>
        {children}
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: [ReactNode, ReactNode] }) {
  return (
    <tr>
      <td className="pt-2 pr-2">{label}</td>
      <td className="pt-2 text-right whitespace-nowrap">{children[0]}</td>
      <td className="pt-2 pl-4 text-right whitespace-nowrap">{children[1]}</td>
    </tr>
  );
}

function Cell({
  c,
  fig,
  version,
  matched,
  animate,
  order,
  current,
}: {
  c: TlfCell | undefined;
  fig: string | undefined;
  version: 3 | 4;
  matched: boolean;
  animate: boolean;
  order: number;
  current: boolean;
}) {
  const { focus, setFocus } = useContext(FigureFocus);
  if (!c) return <span>-</span>;
  const shown = (version === 3 ? c.value_prev : c.value_curr) ?? '-';
  const changed = c.value_prev !== c.value_curr;
  let tone = '';
  let title: string | undefined;
  if (changed && version === 4) {
    if (matched) {
      tone = `bg-recomputed-soft text-recomputed font-bold${animate ? ' figure-new-in' : ''}`;
      title = 'The text now quotes this value';
    } else {
      tone = 'bg-attention-soft text-attention font-bold';
      title = `The text still quotes ${c.value_prev ?? ''}`;
    }
  }
  const active = fig !== undefined && focus === fig;
  return (
    <span
      title={title}
      onMouseEnter={() => fig && setFocus(fig)}
      onMouseLeave={() => setFocus(null)}
      style={animate && matched ? { animationDelay: `${order * 120}ms` } : undefined}
      className={`rounded-[2px] ${tone} ${active ? 'outline-2 outline-cited' : current ? 'outline-1 outline-dashed outline-cited/60' : ''}`}
    >
      {shown}
    </span>
  );
}
