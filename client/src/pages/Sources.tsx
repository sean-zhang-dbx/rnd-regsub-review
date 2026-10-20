import { useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Skeleton } from '@databricks/appkit-ui/react';
import { ArrowUp, Database, FileText, PenLine, ScanSearch, ShieldCheck } from 'lucide-react';
import { ErrorNote } from '../components/QueryBoundary';
import { CELL_LABEL } from '../lib/format';
import { DbxLink } from '../lib/presenter';
import { useAsync } from '../lib/useAsync';
import { typeOf } from './Documents';

/*
 * Sources of CSR 11.4.1, in the order a writer gathers them. Left, the structured side: the certified
 * table behind every figure and the analysis datasets it is built from (Unity Catalog lineage). Right,
 * the unstructured side: the protocol and SAP passages the text draws on, as ai_parse_document parsed
 * them. Middle, the section itself; hovering a sentence lights up its sources, and the other way round.
 */

interface Cell {
  row_key: string;
  column_name: string;
  value: string;
}
interface DocSource {
  kind: 'document' | 'output' | 'writer';
  ref: string;
  page: number | null;
  element_id: number | null;
  quote: string;
  supplies: string;
  doc_title: string;
  element_type: string;
  confidence: number | null;
  content: string;
}
interface SourcesData {
  section: string;
  section_title: string;
  version: number;
  table: {
    name: string;
    fq: string;
    tlf: string;
    comment: string;
    certified_by: string;
    tags: { name: string; value: string }[];
    cells: Cell[];
    upstream: { name: string; rows: number; comment: string }[];
  };
  sentences: { sentence_id: string; seq: number; text: string; figures: Cell[]; sources: DocSource[] }[];
}

const DOC = '#25897c';
const DOC_SOFT = '#e3f2ef';
const ROWS: Record<string, string> = { TRT: 'LMN-4471 400 mg', PBO: 'Placebo', DIFF: 'Difference' };

const passageKey = (s: { ref: string; page: number | null; element_id: number | null }) => `${s.ref}#${s.page}#${s.element_id}`;
const cellKey = (c: Cell) => `${c.row_key}.${c.column_name}`;

/** The parsed text as plain text, starting at the sentence that holds the cited phrase. */
function excerpt(content: string, quote: string): string {
  const text = content
    .replace(/<\/(td|th)>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const at = quote ? text.toLowerCase().indexOf(quote.toLowerCase().replace(/\s+/g, ' ')) : -1;
  const stop = at > 0 ? text.lastIndexOf('. ', at) : -1;
  return stop < 0 ? text : `… ${text.slice(stop + 2)}`;
}

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

async function getSources(): Promise<SourcesData> {
  const r = await fetch('/api/sources');
  if (!r.ok) throw new Error(`/api/sources returned ${r.status}`);
  return (await r.json()) as SourcesData;
}

function ColumnHead({ icon, title, sub, color }: { icon: ReactNode; title: string; sub: string; color: string }) {
  return (
    <div className="mb-3 flex items-center gap-2.5">
      <span className="grid size-8 shrink-0 place-items-center rounded-full text-page" style={{ background: color }}>
        {icon}
      </span>
      <div className="leading-tight">
        <div className="text-[15px] font-semibold text-ink">{title}</div>
        <div className="text-xs text-ink-muted">{sub}</div>
      </div>
    </div>
  );
}

export function Sources() {
  const q = useAsync(getSources);
  const [hoverSentence, setHoverSentence] = useState<string | null>(null);
  const [hoverSource, setHoverSource] = useState<string | null>(null);
  const d = q.data;

  if (q.error) return <ErrorNote title="The sources could not be read." detail={q.error} />;
  if (!d) {
    return (
      <div className="grid h-full grid-cols-[1fr_1.25fr_1fr] gap-6 bg-desk p-6">
        <Skeleton className="h-full" />
        <Skeleton className="h-full" />
        <Skeleton className="h-full" />
      </div>
    );
  }

  /* Which sentences use each source, so either side can light up the other. */
  const usedBy = new Map<string, Set<string>>();
  const use = (k: string, sid: string) => usedBy.set(k, (usedBy.get(k) ?? new Set()).add(sid));
  for (const s of d.sentences) {
    for (const f of s.figures) use(`cell:${cellKey(f)}`, s.sentence_id);
    if (s.figures.length > 0) use('table', s.sentence_id);
    for (const src of s.sources) if (src.kind === 'document') use(`doc:${passageKey(src)}`, s.sentence_id);
  }
  const lit = (key: string) =>
    (hoverSentence !== null && (usedBy.get(key)?.has(hoverSentence) ?? false)) || hoverSource === key;
  const sentenceLit = (sid: string) => hoverSentence === sid || (hoverSource !== null && (usedBy.get(hoverSource)?.has(sid) ?? false));

  /* Passages grouped by document, each once. */
  type Passage = DocSource & { uses: string[] };
  const docs = new Map<string, { title: string; file: string; passages: Map<string, Passage> }>();
  for (const s of d.sentences) {
    for (const src of s.sources.filter((x) => x.kind === 'document')) {
      const doc = docs.get(src.ref) ?? { title: src.doc_title, file: src.ref, passages: new Map<string, Passage>() };
      const k = passageKey(src);
      const p: Passage = doc.passages.get(k) ?? { ...src, uses: [] };
      if (!p.uses.includes(src.supplies)) p.uses.push(src.supplies);
      doc.passages.set(k, p);
      docs.set(src.ref, doc);
    }
  }
  const docList = [...docs.values()].sort((a, b) => (a.title.includes('Protocol') ? -1 : b.title.includes('Protocol') ? 1 : 0));
  const passageCount = docList.reduce((n, x) => n + x.passages.size, 0);
  const certified = d.table.tags.find((t) => t.name === 'system.certification_status')?.value === 'certified';
  const rows = ['TRT', 'PBO', 'DIFF'];

  return (
    <div className="flex h-full flex-col bg-desk">
      <div className="flex h-14 shrink-0 items-center gap-4 border-b border-line bg-page px-5">
        <h1 className="text-lg font-semibold text-ink">
          Sources for CSR {d.section} {d.section_title}
        </h1>
        <span className="rounded-full bg-cited-soft px-2.5 py-0.5 text-xs font-medium text-cited">
          Structured: 1 certified table, {d.table.upstream.length} analysis datasets
        </span>
        <span className="rounded-full px-2.5 py-0.5 text-xs font-medium" style={{ background: DOC_SOFT, color: DOC }}>
          Unstructured: {docList.length} documents, {passageCount} passages
        </span>
        <span className="ml-auto text-xs text-ink-muted">Hover a sentence to see what it is built from</span>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[1fr_1.3fr_1fr] gap-5 overflow-hidden p-5">
        {/* Structured */}
        <section aria-label="Structured sources" className="min-h-0 overflow-y-auto">
          <ColumnHead icon={<Database className="size-4" />} title="Structured data" sub="Unity Catalog tables" color="var(--cited)" />
          <div
            onMouseEnter={() => setHoverSource('table')}
            onMouseLeave={() => setHoverSource(null)}
            className={`rounded-[var(--radius)] border bg-page p-4 transition-shadow ${lit('table') ? 'border-cited shadow-[0_0_0_3px_var(--cited-soft)]' : 'border-line'}`}
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="text-[15px] font-semibold text-ink">{d.table.tlf} Primary efficacy</div>
                <div className="font-mono text-xs text-ink-muted">{d.table.name}</div>
              </div>
              {certified ? (
                <span className="flex shrink-0 items-center gap-1 rounded-full bg-recomputed-soft px-2 py-0.5 text-xs font-medium text-recomputed">
                  <ShieldCheck className="size-3.5" aria-hidden="true" />
                  Certified
                </span>
              ) : null}
            </div>
            <div className="mt-1 text-xs text-ink-muted">
              Released by {d.table.certified_by}, version {d.version}, which the draft is written against
            </div>
            <table className="mt-3 w-full border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-line text-left text-[11px] text-ink-muted">
                  <th className="py-1 font-medium"> </th>
                  <th className="py-1 text-right font-medium">resp.</th>
                  <th className="py-1 text-right font-medium">n</th>
                  <th className="py-1 text-right font-medium">rate / diff</th>
                  <th className="py-1 text-right font-medium">95% CI</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const val = (col: string) => {
                    const c = d.table.cells.find((x) => x.row_key === r && x.column_name === col);
                    if (!c) return null;
                    const on = lit(`cell:${cellKey(c)}`);
                    return (
                      <span
                        title={`${ROWS[r]}, ${CELL_LABEL[c.column_name] ?? c.column_name}`}
                        className={`rounded-[3px] px-1 tabular-nums ${on ? 'bg-cited text-page' : 'text-cited'}`}
                      >
                        {c.value}
                      </span>
                    );
                  };
                  return (
                    <tr key={r} className="border-b border-line last:border-0">
                      <td className="py-1 text-ink">{ROWS[r]}</td>
                      <td className="py-1 text-right">{val('responders')}</td>
                      <td className="py-1 text-right">{val('n')}</td>
                      <td className="py-1 text-right">{r === 'DIFF' ? val('diff_pct') : val('rate_pct')}</td>
                      <td className="py-1 text-right whitespace-nowrap">
                        {r === 'DIFF' ? (
                          <>
                            {val('ci_low')} to {val('ci_high')}
                          </>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="mt-2 text-xs text-ink-muted">{d.table.cells.length} cells are cited in this section</div>
          </div>

          <div className="flex items-center gap-2 py-2 pl-4 text-xs text-ink-muted">
            <ArrowUp className="size-4 text-cited" aria-hidden="true" />
            Built from, by Unity Catalog lineage
            <DbxLink linkKey="beat2" label="Lineage" className="ml-auto" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            {d.table.upstream.map((u) => (
              <div key={u.name} className="rounded-[var(--radius)] border border-line bg-page p-3">
                <div className="font-mono text-[13px] font-semibold text-ink">{u.name}</div>
                <div className="text-xs text-ink-muted">{u.rows.toLocaleString('en-GB')} rows, ADaM</div>
                <div className="mt-1 line-clamp-3 text-xs text-ink-muted">{u.comment.split('. ')[0]}</div>
              </div>
            ))}
          </div>
        </section>

        {/* The section */}
        <section aria-label={`CSR ${d.section}`} className="min-h-0 overflow-y-auto rounded-[var(--radius)] border border-line bg-page px-6 py-5 shadow-[0_1px_3px_rgba(16,24,40,0.08)]">
          <div className="mb-1 text-[11px] font-semibold tracking-wide text-ink-muted uppercase">LMN-301 Clinical Study Report, Draft 0.4</div>
          <h2 className="mb-3 font-serif text-lg font-semibold text-ink">
            {d.section} {d.section_title}
          </h2>
          <ol className="space-y-2">
            {d.sentences.map((s) => {
              const on = sentenceLit(s.sentence_id);
              return (
                <li
                  key={s.sentence_id}
                  onMouseEnter={() => setHoverSentence(s.sentence_id)}
                  onMouseLeave={() => setHoverSentence(null)}
                  className={`rounded-[var(--radius)] px-3 py-2 transition-colors ${on ? 'bg-desk' : ''}`}
                >
                  <p className="font-serif text-[15px] leading-relaxed text-ink">{s.text}</p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5 text-[11px]">
                    {s.figures.length > 0 ? (
                      <span className="flex items-center gap-1 rounded-full bg-cited-soft px-2 py-0.5 font-medium text-cited">
                        <Database className="size-3" aria-hidden="true" />
                        {d.table.tlf}, {s.figures.length} {s.figures.length === 1 ? 'cell' : 'cells'}
                      </span>
                    ) : null}
                    {s.sources.map((src, i) =>
                      src.kind === 'document' ? (
                        <span key={i} className="flex items-center gap-1 rounded-full px-2 py-0.5 font-medium" style={{ background: DOC_SOFT, color: DOC }}>
                          <FileText className="size-3" aria-hidden="true" />
                          {src.doc_title.replace('LMN-301 ', '').replace('Statistical Analysis Plan', 'SAP')} p.{src.page}: {lowerFirst(src.supplies)}
                        </span>
                      ) : src.kind === 'writer' ? (
                        <span key={i} className="flex items-center gap-1 rounded-full bg-attention-soft px-2 py-0.5 font-medium text-attention">
                          <PenLine className="size-3" aria-hidden="true" />
                          {`The writer's wording: ${src.supplies}`}
                        </span>
                      ) : (
                        <span key={i} className="rounded-full border border-dashed border-unchanged px-2 py-0.5 text-ink-muted">
                          {src.ref}, not part of this demo
                        </span>
                      ),
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        </section>

        {/* Unstructured */}
        <section aria-label="Unstructured sources" className="min-h-0 overflow-y-auto">
          <ColumnHead icon={<FileText className="size-4" />} title="Unstructured documents" sub="PDFs parsed with ai_parse_document" color={DOC} />
          <div className="space-y-3">
            {docList.map((doc) => (
              <div key={doc.file} className="rounded-[var(--radius)] border border-line bg-page p-4">
                <div className="text-[15px] font-semibold text-ink">{doc.title}</div>
                <div className="mb-2 font-mono text-xs text-ink-muted">{doc.file.split('/').pop()}</div>
                <div className="space-y-2">
                  {[...doc.passages.entries()].map(([k, p]) => {
                    const on = lit(`doc:${k}`);
                    const t = typeOf(p.element_type);
                    return (
                      <div
                        key={k}
                        onMouseEnter={() => setHoverSource(`doc:${k}`)}
                        onMouseLeave={() => setHoverSource(null)}
                        className="rounded-[4px] border-l-[3px] px-3 py-2 transition-colors"
                        style={{ borderLeftColor: on ? DOC : 'var(--line)', background: on ? DOC_SOFT : undefined }}
                      >
                        <div className="flex items-center gap-2 text-[11px] text-ink-muted">
                          <span className="font-semibold text-ink">Page {p.page}</span>
                          <span className="flex items-center gap-1">
                            <span className="inline-block size-2 rounded-[2px]" style={{ background: t.color }} aria-hidden="true" />
                            {t.label}
                          </span>
                          {p.confidence !== null ? <span>Confidence {p.confidence.toFixed(2)}</span> : null}
                        </div>
                        <div className="mt-0.5 text-[13px] font-medium text-ink">{p.uses.join('; ')}</div>
                        <div className="mt-0.5 line-clamp-2 text-xs text-ink-muted">{excerpt(p.content, p.quote)}</div>
                        <Link
                          to={`/documents?file=${encodeURIComponent(p.ref)}&page=${p.page}&el=${p.element_id}`}
                          className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-cited hover:underline"
                        >
                          <ScanSearch className="size-3.5" aria-hidden="true" />
                          Open the parsed page
                        </Link>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-center gap-3 px-1 text-xs text-ink-muted">
            <Link to="/documents" className="font-medium text-cited hover:underline">
              All parsed documents
            </Link>
            <DbxLink linkKey="beat2_parsed" label="doc_elements table" />
          </div>
        </section>
      </div>
    </div>
  );
}
