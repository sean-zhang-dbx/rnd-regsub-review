import { useState } from 'react';
import { Link } from 'react-router';
import { pageImageUrl } from '../data/api';
import type { SourcePage } from '../data/types';

/* Element types from ai_parse_document (version 2.0), drawn as outlines over the page image. */
const TYPE_STYLE: Record<string, { stroke: string; label: string }> = {
  title: { stroke: '#5b6b80', label: 'title' },
  section_header: { stroke: '#5b6b80', label: 'section header' },
  text: { stroke: '#8a96a6', label: 'text' },
  table: { stroke: '#8a96a6', label: 'table' },
  figure: { stroke: '#8a96a6', label: 'figure' },
  caption: { stroke: '#8a96a6', label: 'caption' },
  page_header: { stroke: '#c3cad3', label: 'page header' },
  page_footer: { stroke: '#c3cad3', label: 'page footer' },
  page_number: { stroke: '#c3cad3', label: 'page number' },
};

/** Region of the page that holds content (page number excluded), so short pages are not mostly white space. */
function crop(page: SourcePage) {
  const bs = page.boxes.filter((b) => b.element_type !== 'page_number');
  if (bs.length === 0) return { x: 0, y: 0, w: page.width, h: page.height };
  const pad = 70;
  const y0 = Math.max(0, Math.min(...bs.map((b) => b.y0)) - pad);
  const y1 = Math.min(page.height, Math.max(...bs.map((b) => b.y1)) + pad);
  const x0 = Math.max(0, Math.min(...bs.map((b) => b.x0)) - pad);
  const x1 = Math.min(page.width, Math.max(...bs.map((b) => b.x1)) + pad);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** A parsed PDF page: the page image ai_parse_document wrote to the volume, with each element's bounding box. */
export function ParsedPage({ page, compact = false }: { page: SourcePage; compact?: boolean }) {
  const [hover, setHover] = useState<number | null>(null);
  const c = crop(page);
  return (
    <figure className={compact ? '' : 'mx-auto max-w-[34rem]'}>
      <div className="overflow-hidden rounded-[2px] border border-line bg-page shadow-[0_1px_3px_rgba(16,24,40,0.12)]">
        <svg viewBox={`${c.x} ${c.y} ${c.w} ${c.h}`} className="block h-auto w-full" role="img" aria-label={`${page.doc_title}, page ${page.page}`}>
          <image href={pageImageUrl(page.image_path)} x={0} y={0} width={page.width} height={page.height} />
          {page.boxes.map((b) => {
            const st = TYPE_STYLE[b.element_type] ?? TYPE_STYLE.text;
            const on = b.used || hover === b.element_id;
            const label = b.used ? `${st.label}, ${page.used_label ?? 'used by the draft'}` : st.label;
            return (
              <g key={b.element_id} onMouseEnter={() => setHover(b.element_id)} onMouseLeave={() => setHover(null)} style={{ pointerEvents: 'all' }}>
                <rect
                  x={b.x0 - 10}
                  y={b.y0 - 10}
                  width={b.x1 - b.x0 + 20}
                  height={b.y1 - b.y0 + 20}
                  fill={b.used ? 'rgba(31,95,174,0.08)' : 'transparent'}
                  stroke={b.used ? '#1f5fae' : st.stroke}
                  strokeWidth={b.used ? 6 : 3}
                  strokeDasharray={b.used ? undefined : '14 10'}
                  rx={6}
                />
                {!compact && on ? (
                  <g>
                    <rect x={b.x0 - 10} y={b.y0 - 56} width={label.length * 17 + 24} height={42} rx={6} fill={b.used ? '#1f5fae' : '#5b6b80'} />
                    <text x={b.x0 + 2} y={b.y0 - 26} fontSize={28} fontFamily="ui-monospace, monospace" fill="#fff">
                      {label}
                    </text>
                  </g>
                ) : null}
              </g>
            );
          })}
        </svg>
      </div>
      {!compact ? (
        <figcaption className="mt-2 text-xs text-ink-muted">
          {page.doc_title}, page {page.page}. Layout and text from ai_parse_document: {page.boxes.length} elements, with the
          passage {page.used_label ?? 'used by the draft'} outlined in blue. Hover an element to see its type.{' '}
          <Link to={`/documents?file=${encodeURIComponent(page.file_path)}&page=${page.page}`} className="text-cited underline underline-offset-4">
            Open in Document parsing
          </Link>
        </figcaption>
      ) : null}
    </figure>
  );
}
