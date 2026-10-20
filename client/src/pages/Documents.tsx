import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Button, Skeleton } from '@databricks/appkit-ui/react';
import { ChevronLeft, ChevronRight, FileText, Minus, Plus } from 'lucide-react';
import { pageImageUrl } from '../data/api';
import { ErrorNote } from '../components/QueryBoundary';
import { DbxLink } from '../lib/presenter';
import { useAsync } from '../lib/useAsync';

/*
 * Document parsing: one source PDF as ai_parse_document (version 2.0) sees it. Left, the page image with a
 * box per element, coloured by type, with its confidence. Right, the parsed content rendered (headings,
 * text, tables from their HTML, figures with their description and the values read from the chart), or the
 * raw elements as JSON. Hovering either side highlights the same element on the other.
 */

interface DocSummary {
  file_path: string;
  doc_title: string;
  pages: number;
  elements: number;
}
interface ParsedElement {
  element_id: number;
  element_type: string;
  confidence: number;
  content: string;
  description: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
interface PageData {
  file_path: string;
  doc_title: string;
  page: number;
  pages: number;
  image_path: string;
  width: number;
  height: number;
  elements: ParsedElement[];
}

const TYPE: Record<string, { label: string; color: string }> = {
  title: { label: 'Title', color: '#c8412d' },
  section_header: { label: 'Section header', color: '#c8412d' },
  text: { label: 'Text', color: '#25897c' },
  table: { label: 'Table', color: '#3b8a3e' },
  figure: { label: 'Figure', color: '#2563c9' },
  caption: { label: 'Caption', color: '#7652c9' },
  page_header: { label: 'Page header', color: '#c98a1e' },
  page_footer: { label: 'Page footer', color: '#c98a1e' },
  page_number: { label: 'Page number', color: '#c98a1e' },
};
export const typeOf = (t: string) => TYPE[t] ?? { label: t, color: '#5b6b80' };

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} returned ${r.status}`);
  return (await r.json()) as T;
}

/** Keep only table markup from the parser's HTML, without attributes. */
function safeTable(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const allowed = new Set(['TABLE', 'THEAD', 'TBODY', 'TR', 'TH', 'TD', 'B', 'I', 'BR']);
  const walk = (n: ChildNode): string => {
    if (n.nodeType === Node.TEXT_NODE) return (n.textContent ?? '').replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c] ?? c);
    if (!(n instanceof HTMLElement)) return '';
    const inner = Array.from(n.childNodes).map(walk).join('');
    return allowed.has(n.tagName) ? `<${n.tagName.toLowerCase()}>${inner}</${n.tagName.toLowerCase()}>` : inner;
  };
  return Array.from(doc.body.childNodes).map(walk).join('');
}

/** Values the parser read from a chart: {"values": {series: {category: value}}}. */
function chartValues(content: string): { name: string; value: string }[] {
  try {
    const j = JSON.parse(content) as { values?: Record<string, unknown> };
    const out: { name: string; value: string }[] = [];
    for (const [series, v] of Object.entries(j.values ?? {})) {
      if (v && typeof v === 'object') {
        for (const [cat, val] of Object.entries(v as Record<string, unknown>)) out.push({ name: cat === series ? series : `${series}, ${cat}`, value: String(val) });
      } else out.push({ name: series, value: String(v) });
    }
    return out;
  } catch {
    return [];
  }
}

function Mark({ text, term }: { text: string; term: string }) {
  if (!term) return <>{text}</>;
  const parts = text.split(new RegExp(`(${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'));
  return (
    <>
      {parts.map((p, i) => (p.toLowerCase() === term.toLowerCase() ? <mark key={i} className="rounded-[2px] bg-attention-soft px-0.5 text-ink">{p}</mark> : <span key={i}>{p}</span>))}
    </>
  );
}

export function Documents() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const docs = useAsync(() => getJson<DocSummary[]>('/api/documents'));
  const file = params.get('file') ?? docs.data?.find((d) => /Briefing/.test(d.file_path))?.file_path ?? docs.data?.[0]?.file_path ?? '';
  const page = Number(params.get('page') ?? '1');
  const term = params.get('q') ?? '';
  const elParam = Number(params.get('el') ?? 'NaN');
  const [view, setView] = useState<'rendered' | 'json'>('rendered');
  const [zoom, setZoom] = useState(1);
  const [hover, setHover] = useState<number | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [nonce, setNonce] = useState(0);
  const pageData = useAsync(() => getJson<PageData>(`/api/documents/page?file=${encodeURIComponent(file)}&page=${page}`), file !== '');
  const rightRef = useRef<HTMLDivElement | null>(null);

  /* Reload when the document or page changes. */
  useEffect(() => {
    if (file) pageData.retry();
    setSelected(Number.isInteger(elParam) ? elParam : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file, page, nonce]);

  const p = pageData.data;
  const matches = useMemo(
    () => (p && term ? p.elements.filter((e) => `${e.content} ${e.description}`.toLowerCase().includes(term.toLowerCase())).map((e) => e.element_id) : []),
    [p, term],
  );
  const active = hover ?? selected ?? matches[0] ?? null;

  useEffect(() => {
    if (p && Number.isInteger(elParam)) {
      document.getElementById(`el-${elParam}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }, [p, elParam]);

  useEffect(() => {
    if (matches[0] !== undefined) {
      document.getElementById(`el-${matches[0]}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }, [matches]);

  function go(next: { file?: string; page?: number; q?: string | null }) {
    const sp = new URLSearchParams(params);
    if (next.file !== undefined) sp.set('file', next.file);
    if (next.page !== undefined) sp.set('page', String(next.page));
    if (next.q === null) sp.delete('q');
    if (next.file !== undefined || next.page !== undefined) sp.delete('el');
    setParams(sp);
    setNonce((n) => n + 1);
  }

  const current = docs.data?.find((d) => d.file_path === file);
  const fileName = file.split('/').pop() ?? '';
  const counts = p ? Object.entries(p.elements.reduce<Record<string, number>>((m, e) => ({ ...m, [e.element_type]: (m[e.element_type] ?? 0) + 1 }), {})) : [];

  return (
    <div className="flex h-full flex-col bg-page">
      {/* Header */}
      <div className="flex h-14 shrink-0 items-center gap-4 border-b border-line px-5">
        <Button variant="ghost" size="icon" aria-label="Back" onClick={() => void navigate(-1)} className="size-8 text-ink-muted">
          <ChevronLeft className="size-5" />
        </Button>
        <h1 className="text-lg font-semibold text-ink">Document parsing</h1>
        <span className="rounded-[var(--radius)] bg-muted px-2 py-0.5 text-xs text-ink-muted">{docs.data ? `${docs.data.length} documents` : ''}</span>
        <div className="mx-auto flex min-w-0 items-center gap-2">
          <FileText className="size-4 shrink-0 text-ink-muted" aria-hidden="true" />
          <select
            aria-label="Document"
            value={file}
            onChange={(e) => go({ file: e.target.value, page: 1, q: null })}
            className="max-w-[26rem] truncate rounded-[var(--radius)] border border-line bg-page px-2 py-1 text-sm font-medium text-ink"
          >
            {(docs.data ?? []).map((d) => (
              <option key={d.file_path} value={d.file_path}>
                {d.doc_title} ({d.pages} pages)
              </option>
            ))}
          </select>
          <span className="hidden truncate font-mono text-xs text-ink-muted min-[1300px]:inline">{fileName}</span>
        </div>
        <div className="flex shrink-0 items-center gap-4 text-xs text-ink-muted">
          <DbxLink linkKey="beat1_volume" label="Volume source_docs" />
          <DbxLink linkKey="beat2_parsed" label="doc_elements table" />
          <span>ai_parse_document, version 2.0</span>
        </div>
      </div>
      {docs.error ? <ErrorNote title="The documents could not be listed." detail={docs.error} /> : null}

      <div className="grid min-h-0 flex-1 grid-cols-2">
        {/* Left: page with boxes */}
        <section aria-label="Parsed page" className="flex min-h-0 flex-col border-r border-line">
          <div className="flex min-h-11 shrink-0 items-center justify-between border-b border-line px-4 py-1.5 text-sm">
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 pr-3 text-xs">
              {counts.map(([t, n]) => (
                <span key={t} className="flex items-center gap-1.5 text-ink-muted">
                  <span className="inline-block size-2.5 rounded-[2px]" style={{ background: typeOf(t).color }} aria-hidden="true" />
                  {typeOf(t).label} {n}
                </span>
              ))}
            </div>
            <div className="flex shrink-0 items-center gap-1 whitespace-nowrap">
              <Button variant="ghost" size="icon" aria-label="Previous page" disabled={page <= 1} onClick={() => go({ page: page - 1, q: null })} className="size-7">
                <ChevronLeft className="size-4" />
              </Button>
              <span className="tabular-nums text-ink">
                {page} / {p?.pages ?? current?.pages ?? '…'}
              </span>
              <Button variant="ghost" size="icon" aria-label="Next page" disabled={!!p && page >= p.pages} onClick={() => go({ page: page + 1, q: null })} className="size-7">
                <ChevronRight className="size-4" />
              </Button>
              <span className="mx-2 h-5 w-px bg-line" aria-hidden="true" />
              <Button variant="ghost" size="icon" aria-label="Zoom out" disabled={zoom <= 0.6} onClick={() => setZoom((z) => +(z - 0.2).toFixed(1))} className="size-7">
                <Minus className="size-4" />
              </Button>
              <span className="w-11 text-center tabular-nums text-ink">{Math.round(zoom * 100)}%</span>
              <Button variant="ghost" size="icon" aria-label="Zoom in" disabled={zoom >= 2} onClick={() => setZoom((z) => +(z + 0.2).toFixed(1))} className="size-7">
                <Plus className="size-4" />
              </Button>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-auto bg-desk p-6">
            {pageData.loading || !p ? (
              <Skeleton className="mx-auto aspect-[1/1.414] w-full max-w-[40rem]" />
            ) : pageData.error ? (
              <ErrorNote title="The page could not be read." detail={pageData.error} />
            ) : (
              <div className="mx-auto shadow-[0_1px_4px_rgba(16,24,40,0.15)]" style={{ width: `${zoom * 100}%`, maxWidth: `${zoom * 40}rem` }}>
                <svg viewBox={`0 0 ${p.width} ${p.height}`} className="block h-auto w-full bg-page" role="img" aria-label={`${p.doc_title}, page ${p.page}`}>
                  <image href={pageImageUrl(p.image_path)} x={0} y={0} width={p.width} height={p.height} />
                  {p.elements.map((e) => {
                    const t = typeOf(e.element_type);
                    const on = active === e.element_id;
                    const label = `${t.label} | Confidence ${e.confidence.toFixed(2)}`;
                    return (
                      <g
                        key={e.element_id}
                        onMouseEnter={() => setHover(e.element_id)}
                        onMouseLeave={() => setHover(null)}
                        onClick={() => {
                          setSelected(e.element_id);
                          document.getElementById(`el-${e.element_id}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
                        }}
                        style={{ cursor: 'pointer', pointerEvents: 'all' }}
                      >
                        <rect
                          x={e.x0 - 8}
                          y={e.y0 - 8}
                          width={e.x1 - e.x0 + 16}
                          height={e.y1 - e.y0 + 16}
                          fill={on ? `${t.color}1f` : 'transparent'}
                          stroke={t.color}
                          strokeWidth={on ? 6 : 3}
                          rx={4}
                        />
                        {on ? (
                          <g>
                            <rect x={e.x0 - 8} y={e.y0 - 58} width={label.length * 16.5 + 30} height={44} rx={6} fill="#fff" stroke={t.color} strokeWidth={3} />
                            <circle cx={e.x0 + 12} cy={e.y0 - 36} r={7} fill={t.color} />
                            <text x={e.x0 + 28} y={e.y0 - 26} fontSize={27} fontFamily="ui-sans-serif, system-ui" fill="#1b1f24">
                              <tspan fontWeight={700} fill={t.color}>{t.label}</tspan>
                              {` | Confidence ${e.confidence.toFixed(2)}`}
                            </text>
                          </g>
                        ) : null}
                      </g>
                    );
                  })}
                </svg>
              </div>
            )}
          </div>
        </section>

        {/* Right: parsed content */}
        <section aria-label="Parsed content" className="flex min-h-0 flex-col">
          <div className="flex h-11 shrink-0 items-center justify-between border-b border-line px-4 text-sm">
            <span className="text-ink-muted">
              {p ? `${p.doc_title}, page ${p.page}` : ''}
              {term ? (
                <span className="ml-3 rounded-full bg-attention-soft px-2 py-0.5 text-xs text-ink">
                  {matches.length > 0 ? `"${term}" found` : `"${term}" not on this page`}
                </span>
              ) : null}
            </span>
            <div role="radiogroup" aria-label="View" className="flex overflow-hidden rounded-[var(--radius)] border border-line text-xs">
              {(['rendered', 'json'] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  role="radio"
                  aria-checked={view === v}
                  onClick={() => setView(v)}
                  className={`px-2.5 py-1 ${view === v ? 'bg-cited text-page' : 'bg-page text-ink-muted hover:bg-desk'}`}
                >
                  {v === 'rendered' ? 'Rendered' : 'JSON'}
                </button>
              ))}
            </div>
          </div>
          <div ref={rightRef} className="min-h-0 flex-1 overflow-y-auto px-8 py-6">
            {!p ? null : view === 'json' ? (
              <pre className="whitespace-pre-wrap break-words font-mono text-[12px] leading-relaxed text-ink">
                {JSON.stringify(
                  p.elements.map((e) => ({
                    id: e.element_id,
                    type: e.element_type,
                    confidence: e.confidence,
                    bbox: [{ coord: [e.x0, e.y0, e.x1, e.y1], page_id: p.page - 1 }],
                    content: e.content,
                    description: e.description || null,
                  })),
                  null,
                  2,
                )}
              </pre>
            ) : (
              <div className="mx-auto max-w-[44rem] space-y-3">
                {p.elements.map((e) => {
                  const t = typeOf(e.element_type);
                  const on = active === e.element_id;
                  const wrap = (child: ReactNode, cls = '') => (
                    <div
                      key={e.element_id}
                      id={`el-${e.element_id}`}
                      onMouseEnter={() => setHover(e.element_id)}
                      onMouseLeave={() => setHover(null)}
                      className={`scroll-mt-4 rounded-[4px] border-l-[3px] px-3 py-1 transition-colors ${cls}`}
                      style={{ borderLeftColor: on ? t.color : 'transparent', background: on ? `${t.color}10` : undefined }}
                    >
                      {child}
                    </div>
                  );
                  if (e.element_type === 'title') return wrap(<h2 className="text-2xl font-semibold text-ink"><Mark text={e.content} term={term} /></h2>);
                  if (e.element_type === 'section_header') return wrap(<h3 className="text-xl font-semibold text-ink"><Mark text={e.content} term={term} /></h3>);
                  if (['page_header', 'page_footer', 'page_number'].includes(e.element_type))
                    return wrap(<p className="text-center text-xs text-ink-muted">{e.content}</p>);
                  if (e.element_type === 'caption') return wrap(<p className="text-sm italic text-ink-muted"><Mark text={e.content} term={term} /></p>);
                  if (e.element_type === 'table')
                    return wrap(
                      <div
                        className="overflow-x-auto text-sm [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:border-line [&_td]:px-3 [&_td]:py-1.5 [&_th]:border [&_th]:border-line [&_th]:bg-desk [&_th]:px-3 [&_th]:py-1.5 [&_th]:text-left [&_th]:font-semibold"
                        // eslint-disable-next-line react/no-danger
                        dangerouslySetInnerHTML={{ __html: safeTable(e.content) }}
                      />,
                    );
                  if (e.element_type === 'figure') {
                    const vals = chartValues(e.content);
                    return wrap(
                      <div className="space-y-2 rounded-[4px] bg-desk p-3">
                        <p className="text-sm italic text-ink-muted">[Figure]</p>
                        <p className="italic text-ink">{e.description}</p>
                        {vals.length > 0 ? (
                          <>
                            <p className="text-xs font-semibold text-ink-muted">Values read from the chart</p>
                            <table className="w-full border-collapse text-sm">
                              <tbody>
                                {vals.map((v) => (
                                  <tr key={v.name} className="border-b border-line">
                                    <td className="py-1 pr-4 text-ink">{v.name}</td>
                                    <td className="py-1 text-right tabular-nums font-medium text-ink">
                                      <Mark text={v.value} term={term} />
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </>
                        ) : null}
                      </div>,
                    );
                  }
                  return wrap(
                    <div className="space-y-2 leading-relaxed text-ink">
                      {e.content.split(/\n\s*\n/).map((para, i) => (
                        <p key={i}>
                          <Mark text={para.replace(/\n/g, ' ')} term={term} />
                        </p>
                      ))}
                    </div>,
                  );
                })}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
