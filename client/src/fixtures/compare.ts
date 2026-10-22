import type { Compare, ComparePage, Part, Sentence, Tick } from '../data/types';

/*
 * FIXTURE for GET /api/compare?section=11.4.1. The numbers are invented. The two "submitted" pages are
 * drawn as SVG so the layout can be built before the page images exist in the volume.
 */

const TLF = 'tlf_14_3_01_adascog_w24';
const TABLE_PAGE = 61;
const BODY_PAGE = 27;
const TABLE_ELEMENT = 9001;

const fig = (slot: string, value: string, row_key: string, column_name: string): Part => ({
  slot,
  value,
  source_table: `sean_zhang_catalog.rnd_csr_pod.${TLF}`,
  tlf: TLF,
  row_key,
  column_name,
  table_version: 1,
});
const txt = (text: string): Part => ({ text });
const sentence = (parts: Part[], extra: Partial<Sentence> = {}): Sentence => ({
  template: parts.map((p) => ('text' in p ? p.text : `{${p.slot}}`)).join(''),
  parts,
  sources: [{ kind: 'tlf', tlf: TLF, table: TLF }],
  ...extra,
});

const drafted: Sentence[] = [
  sentence([
    txt('The efficacy population at Week 24 included '),
    fig('n_pbo', '79', 'n', 'pbo'),
    txt(' patients in the placebo group, '),
    fig('n_low', '81', 'n', 'low'),
    txt(' in the Xanomeline low dose group and '),
    fig('n_high', '74', 'n', 'high'),
    txt(' in the Xanomeline high dose group.'),
  ]),
  sentence([
    txt('The mean ADAS-Cog (11) score at baseline was '),
    fig('bl_pbo', '24.1', 'baseline_mean', 'pbo'),
    txt(' for placebo, '),
    fig('bl_low', '24.0', 'baseline_mean', 'low'),
    txt(' for the low dose and '),
    fig('bl_high', '23.7', 'baseline_mean', 'high'),
    txt(' for the high dose.'),
  ]),
  sentence([
    txt('The least squares mean change from baseline to Week 24 was '),
    fig('ls_pbo', '0.6', 'ls_mean_change', 'pbo'),
    txt(' for placebo, '),
    fig('ls_low', '0.2', 'ls_mean_change', 'low'),
    txt(' for the low dose and '),
    fig('ls_high', '-1.2', 'ls_mean_change', 'high'),
    txt(' for the high dose.'),
  ]),
  sentence([
    txt('For the high dose, the difference from placebo was '),
    fig('diff_high', '-1.8', 'diff_vs_pbo', 'high'),
    txt(' (95% CI '),
    fig('ci_lo', '-3.8', 'ci_low', 'high'),
    txt(' to '),
    fig('ci_hi', '0.2', 'ci_high', 'high'),
    txt('; p = '),
    fig('p_high', '0.074', 'p_value', 'high'),
    txt(').'),
  ]),
  sentence([txt('These results point to a modest benefit of the high dose on cognition that needs to be read with the safety findings.')], {
    interpretation: true,
    sources: [{ kind: 'writer' }],
  }),
];

const ticks: Tick[] = drafted.flatMap((s, sentence_idx) =>
  s.parts.flatMap((p): Tick[] =>
    'slot' in p
      ? [
          {
            sentence_idx,
            slot: p.slot,
            drafted_value: p.value,
            tlf: p.tlf,
            row_key: p.row_key,
            column_name: p.column_name,
            table_version: p.table_version,
            printed_value: p.value,
            printed_page: TABLE_PAGE,
            printed_element_id: TABLE_ELEMENT,
            match: true,
          },
        ]
      : [],
  ),
);

/* Page images */
const W = 612;
const H = 792;
const svgUri = (inner: string) =>
  `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="#ffffff"/>${inner}</svg>`,
  )}`;
const t = (x: number, y: number, s: string, size = 10, weight = 400, anchor = 'start') =>
  `<text x="${x}" y="${y}" font-family="Times New Roman, serif" font-size="${size}" font-weight="${weight}" text-anchor="${anchor}" fill="#222">${s.replace(/&/g, '&amp;')}</text>`;
const rule = (y: number) => `<line x1="54" x2="558" y1="${y}" y2="${y}" stroke="#555" stroke-width="0.6"/>`;

const tableRows: [string, string, string, string][] = [
  ['n', '79', '81', '74'],
  ['Baseline, mean', '24.1', '24.0', '23.7'],
  ['Week 24, mean', '24.7', '24.2', '22.5'],
  ['LS mean change from baseline', '0.6', '0.2', '-1.2'],
  ['Difference vs placebo (LS mean)', '', '-0.4', '-1.8'],
  ['95% CI, lower', '', '-2.4', '-3.8'],
  ['95% CI, upper', '', '1.6', '0.2'],
  ['p-value vs placebo', '', '0.693', '0.074'],
];
const tableSvg =
  t(306, 64, 'Table 14-3.01', 11, 700, 'middle') +
  t(306, 80, 'ADAS-Cog (11) change from baseline to Week 24, LOCF, efficacy population', 9.5, 400, 'middle') +
  t(54, 128, 'Statistic', 9.5, 700) +
  t(330, 128, 'Placebo', 9.5, 700, 'end') +
  t(420, 128, 'Xan. low dose', 9.5, 700, 'end') +
  t(540, 128, 'Xan. high dose', 9.5, 700, 'end') +
  rule(136) +
  tableRows
    .map(
      (r, i) =>
        t(54, 156 + i * 30, r[0]) + t(330, 156 + i * 30, r[1], 10, 400, 'end') + t(420, 156 + i * 30, r[2], 10, 400, 'end') + t(540, 156 + i * 30, r[3], 10, 400, 'end'),
    )
    .join('') +
  rule(156 + tableRows.length * 30 - 14) +
  t(54, 420, 'Fixture page. Source: invented values for layout only.', 8, 400);

const bodyLines = [
  '11.4.1 Primary efficacy endpoint: ADAS-Cog (11)',
  'The efficacy population at Week 24 included 79 patients in the placebo group,',
  '81 in the low dose group and 74 in the high dose group.',
  'The least squares mean change from baseline to Week 24 was 0.6, 0.2 and -1.2',
  'respectively. The difference from placebo for the high dose was -1.8',
  '(95% CI -3.8 to 0.2; p = 0.074). See Table 14-3.01.',
];
const bodySvg = bodyLines.map((l, i) => t(54, 96 + i * 18, l, i === 0 ? 11 : 10, i === 0 ? 700 : 400)).join('') + t(54, 420, 'Fixture page. Source: invented values for layout only.', 8, 400);

const pages: ComparePage[] = [
  {
    page: BODY_PAGE,
    image_path: svgUri(bodySvg),
    width: W,
    height: H,
    elements: [
      { element_id: 5101, element_type: 'section_header', x0: 54, y0: 84, x1: 400, y1: 100, content: '11.4.1 Primary efficacy endpoint: ADAS-Cog (11)' },
      { element_id: 5102, element_type: 'text', x0: 54, y0: 108, x1: 558, y1: 190, content: bodyLines.slice(1).join(' ') },
    ],
  },
  {
    page: TABLE_PAGE,
    image_path: svgUri(tableSvg),
    width: W,
    height: H,
    elements: [
      { element_id: 9000, element_type: 'title', x0: 130, y0: 52, x1: 482, y1: 86, content: 'Table 14-3.01 ADAS-Cog (11) change from baseline to Week 24' },
      { element_id: TABLE_ELEMENT, element_type: 'table', x0: 54, y0: 116, x1: 558, y1: 372, content: '<table>...</table>' },
    ],
  },
];

export const compareFixture: Compare = {
  section: '11.4.1',
  drafted,
  submitted: { pages, text: bodyLines.join(' ') },
  ticks,
  wording: {
    coverage_score: 4,
    notes: 'The draft covers the endpoint definition, the analysis population and the high dose result. It does not give the dose-response trend test.',
    left_for_person: [
      'The writer\'s reading of the high dose result against the low dose, which the table alone does not settle.',
      'The statement on clinical relevance of a 1.8 point difference.',
      'The link to the safety findings in section 12.',
    ],
  },
};

export function compareFixtureFor(section: string): Compare {
  return section === '11.4.1' ? compareFixture : { ...compareFixture, section };
}
