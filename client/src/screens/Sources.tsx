import { cn } from '@/lib/utils';
import { EmptyBlock, ErrorBlock, LoadingBlock, Panel } from '../components/States';
import { getSources } from '../data/api';
import type { Sources as SourcesData } from '../data/types';
import { useAsync } from '../hooks/useAsync';
import { tlfLabel } from '../lib/format';
import { XRayMarker } from '../xray/XRay';

const PART_LABEL: Record<string, string> = {
  protocol: 'Protocol',
  protocol_appendix: 'Protocol appendices',
  sap: 'Statistical analysis plan',
  csr_body: 'Submitted CSR, body',
  csr_tlf: 'Submitted CSR, section 14 tables',
  references: 'References',
  appendix_index: 'Appendix index',
  other: 'Other',
};
const n = (v: number) => v.toLocaleString('en-GB');

function PanelTitle({ children, note }: { children: string; note?: string }) {
  return (
    <header className="flex items-baseline gap-3 border-b border-border px-5 py-3 pr-12">
      <h2 className="text-[16px] font-semibold">{children}</h2>
      {note ? <p className="text-[13px] text-muted-foreground">{note}</p> : null}
    </header>
  );
}

function Adam({ d }: { d: SourcesData['adam'] }) {
  return (
    <Panel>
      <XRayMarker id="sources_adam" />
      <PanelTitle note="Loaded from the CDISC files, values unchanged">Analysis data</PanelTitle>
      {d.length === 0 ? (
        <div className="p-4">
          <EmptyBlock title="No analysis tables found">Run the load script to create the adam tables.</EmptyBlock>
        </div>
      ) : (
        <table className="w-full text-[14px]">
          <thead>
            <tr className="text-left text-[13px] text-muted-foreground">
              <th className="px-5 py-2 font-normal">Table</th>
              <th className="px-3 py-2 text-right font-normal">Rows</th>
              <th className="px-3 py-2 text-right font-normal">Columns</th>
              <th className="px-5 py-2 font-normal">Checksum</th>
            </tr>
          </thead>
          <tbody>
            {d.map((t) => (
              <tr key={t.table} className="border-t border-border/70">
                <td className="num px-5 py-2">{t.table}</td>
                <td className="num px-3 py-2 text-right">{n(t.rows)}</td>
                <td className="num px-3 py-2 text-right">{t.columns}</td>
                <td className={cn('px-5 py-2 text-[13px]', t.checksum_ok ? 'text-match' : 'font-medium text-differs')}>{t.checksum_ok ? 'Matches the file' : 'Differs from the file'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Panel>
  );
}

function Tlfs({ d }: { d: SourcesData['tlfs'] }) {
  return (
    <Panel>
      <XRayMarker id="sources_tlf" />
      <PanelTitle note="Built from the analysis data">Certified tables</PanelTitle>
      {d.length === 0 ? (
        <div className="p-4">
          <EmptyBlock title="No certified tables found">Run the TLF build job.</EmptyBlock>
        </div>
      ) : (
        <ul>
          {d.map((t) => (
            <li key={t.table} className="grid grid-cols-[116px_minmax(0,1fr)_auto] items-center gap-3 border-t border-border/70 px-5 py-2 first:border-t-0">
              <span className="num text-[13px] whitespace-nowrap">{tlfLabel(t.table)}</span>
              <span className="min-w-0">
                <span className="num block truncate text-[13px]">{t.table}</span>
                <span className="block truncate text-[12px] text-muted-foreground">
                  from <span className="num">{t.upstreams.join(', ')}</span>
                </span>
              </span>
              <span className="text-right text-[12px] whitespace-nowrap text-muted-foreground">
                version <span className="num">{t.version}</span>
                <br />
                {t.certified ? 'certified' : 'not certified'}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function Docs({ d, index }: { d: SourcesData['docs']; index: SourcesData['index'] }) {
  const total = d.pages || 1;
  const parts = [...d.parts].sort((a, b) => a.page_from - b.page_from);
  return (
    <Panel>
      <XRayMarker id="sources_docs" />
      <PanelTitle note={`${d.file}, ${d.pages} pages, kept whole`}>Documents</PanelTitle>
      <div className="px-5 pt-4 pb-2">
        <div className="flex h-7 w-full gap-px overflow-hidden rounded-control" role="img" aria-label="Pages of the PDF by part">
          {parts.map((p) => (
            <div
              key={p.doc_part}
              title={`${PART_LABEL[p.doc_part] ?? p.doc_part}, pages ${p.page_from} to ${p.page_to}`}
              style={{ width: `${((p.page_to - p.page_from + 1) / total) * 100}%` }}
              className={cn(p.searchable ? 'bg-primary' : 'bg-foreground/25')}
            />
          ))}
        </div>
      </div>
      <ul className="pb-2">
        {parts.map((p) => (
          <li key={p.doc_part} className="grid grid-cols-[minmax(0,1fr)_96px_56px_80px] items-center gap-3 px-5 py-1.5 text-[14px]">
            <span className="flex items-center gap-2">
              <span className={cn('size-2.5 shrink-0 rounded-sm', p.searchable ? 'bg-primary' : 'bg-foreground/25')} aria-hidden="true" />
              {PART_LABEL[p.doc_part] ?? p.doc_part}
            </span>
            <span className="num text-[13px] text-muted-foreground">
              p {p.page_from} to {p.page_to}
            </span>
            <span className="num text-right text-[13px]">{n(p.elements)}</span>
            <span className={cn('text-[13px]', p.searchable ? 'font-medium text-primary' : 'text-muted-foreground')}>{p.searchable ? 'Searchable' : 'Locked'}</span>
          </li>
        ))}
      </ul>
      <div className="relative border-t border-border px-5 py-3 text-[14px]">
        <XRayMarker id="sources_search" className="top-2.5" />
        <span className="num">{index.name}</span>
        <span className="ml-3 text-[13px] text-muted-foreground">
          <span className="num">{n(index.chunks)}</span> passages from the protocol and the SAP
        </span>
      </div>
    </Panel>
  );
}

export function Sources() {
  const s = useAsync(getSources);
  return (
    <div className="mx-auto max-w-[1180px]">
      <h1 className="text-[26px] leading-tight font-semibold tracking-[-0.01em]">The submitted report is the answer key. The pod cannot read it.</h1>
      <div className="mt-6">
        {s.loading ? (
          <LoadingBlock rows={8} />
        ) : s.error || !s.data ? (
          <ErrorBlock title="The sources could not be loaded" detail={s.error} onRetry={s.retry} />
        ) : (
          <div className="grid grid-cols-1 items-start gap-5 min-[1240px]:grid-cols-2">
            <div className="space-y-5">
              <Adam d={s.data.adam} />
              <Tlfs d={s.data.tlfs} />
            </div>
            <Docs d={s.data.docs} index={s.data.index} />
          </div>
        )}
      </div>
    </div>
  );
}
