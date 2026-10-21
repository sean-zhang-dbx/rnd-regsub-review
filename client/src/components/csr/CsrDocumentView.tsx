/* Lists here are append-only or fixed per render and have no stable ids, so index keys are correct. */
/* eslint-disable react/no-array-index-key */
import { Fragment } from 'react';
import { Link } from 'react-router';
import type { CsrSection, Redelivery, Sentence, SourceRef } from '../../data/csr';
import { cn } from '../../lib/utils';
import { SECTION_VIEW } from './RedeliveryBanner';
import { shortDoc } from './model';

function sourceLabel(s: SourceRef): string {
  if (s.kind === 'passage') return `${shortDoc(s.doc_title)} p${s.page}`;
  if (s.kind === 'tlf') return s.tlf;
  return 'Writer';
}

function dedupe(sources: SourceRef[]): SourceRef[] {
  const seen = new Set<string>();
  return sources.filter((s) => {
    const k = sourceLabel(s);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function SourceChip({ s }: { s: SourceRef }) {
  const tone = s.kind === 'passage' ? 'bg-recomputed-soft text-recomputed' : s.kind === 'tlf' ? 'bg-cited-soft text-cited' : 'bg-open-soft text-ink-muted';
  return (
    <span title={s.kind === 'passage' ? s.quote : s.kind === 'tlf' ? s.table : 'Written by the report writer'} className={cn('mx-px rounded-[3px] px-1 py-px align-baseline font-sans text-[10.5px] font-medium whitespace-nowrap', tone)}>
      {sourceLabel(s)}
    </span>
  );
}

function SentenceView({ s, idx, section, changed, flash }: { s: Sentence; idx: number; section: string; changed: Redelivery | undefined; flash: boolean }) {
  return (
    <Fragment>
      {s.heading ? <h4 className="mt-4 mb-1 font-sans text-[13px] font-semibold text-ink">{s.heading}</h4> : null}
      <span id={`s-${section}-${idx}`} className={cn('rounded-[2px]', changed && 'bg-attention-soft', flash && 'ring-2 ring-attention', s.interpretation && 'underline decoration-attention decoration-dotted underline-offset-4')}>
        {s.parts.map((p, i) =>
          'slot' in p ? (
            <span key={i} className="group relative">
              <span className="rounded-[2px] bg-cited-soft px-0.5 font-medium text-cited">{p.value}</span>
              <span role="tooltip" className="pointer-events-none absolute bottom-full left-0 z-30 mb-1 hidden w-max max-w-[260px] rounded-[var(--radius)] bg-bar px-2.5 py-1.5 font-sans text-[11.5px] leading-snug font-normal text-page shadow-page group-hover:block">
                <span className="block font-semibold">{p.value}</span>
                {p.tlf}, row {p.row_key}
                <br />
                column {p.column_name}, version {p.table_version}
                <br />
                <span className="text-bar-muted">{p.source_table}</span>
              </span>
            </span>
          ) : (
            <span key={i}>{p.text}</span>
          ),
        )}
      </span>{' '}
      {dedupe(s.sources).map((r) => (
        <SourceChip key={sourceLabel(r)} s={r} />
      ))}{' '}
    </Fragment>
  );
}

export function CsrDocumentView({
  sections,
  selected,
  redelivery,
  flashSection,
}: {
  sections: CsrSection[];
  selected: string | null;
  redelivery: Redelivery[];
  flashSection: string | null;
}) {
  return (
    <div className="mx-auto max-w-[760px] space-y-6 py-6">
      {sections.map((sec) => (
        <article key={sec.section} id={`sec-${sec.section}`} className={cn('scroll-mt-4 bg-page px-12 py-9 shadow-page', selected === sec.section && 'ring-2 ring-cited/50')}>
          <h3 className="font-sans text-[15px] font-semibold text-ink">
            <span className="mr-3 text-ink-muted">{sec.section}</span>
            {sec.title}
          </h3>
          {sec.html ? (
            /* Assembled sections are rendered by our own server from certified tables, not from user input. */
            <div className="doc-body csr-html mt-3" dangerouslySetInnerHTML={{ __html: sec.html }} />
          ) : (
            <div className="doc-body mt-3">
              {sec.sentences.length === 0 ? <span className="text-ink-muted">This section has no text yet.</span> : null}
              {sec.sentences.map((s, i) => (
                <SentenceView
                  key={i}
                  s={s}
                  idx={i}
                  section={sec.section}
                  changed={redelivery.find((r) => r.section === sec.section && r.sentence_idx === i)}
                  flash={flashSection === sec.section && redelivery.some((r) => r.section === sec.section && r.sentence_idx === i)}
                />
              ))}
            </div>
          )}
          {sec.section === '11.4.1' ? (
            <p className="mt-3 font-sans text-xs">
              <Link to={SECTION_VIEW} className="font-medium text-cited underline underline-offset-4">
                Open the section view
              </Link>
            </p>
          ) : null}
        </article>
      ))}
    </div>
  );
}
