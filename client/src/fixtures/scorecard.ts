import type { Scorecard, ScoreRow } from '../data/types';

/* FIXTURE. Section 12.2 differs until the re-delivery has run (see state.ts). */
const MW = 'Medical Writing';
const BS = 'Biostatistics';
const CS = 'Clinical Safety';

const BASE: Omit<ScoreRow, 'status'>[] = [
  { section: '2', title: 'Synopsis', department: MW, figures_total: 22, figures_matched: 22, coverage_score: 4, needs_person: 1 },
  { section: '9.1', title: 'Overall study design', department: MW, figures_total: 9, figures_matched: 9, coverage_score: 4, needs_person: 0 },
  { section: '9.4', title: 'Treatments', department: MW, figures_total: 21, figures_matched: 21, coverage_score: 4, needs_person: 0 },
  { section: '9.7', title: 'Statistical methods planned in the protocol', department: BS, figures_total: 8, figures_matched: 8, coverage_score: 4, needs_person: 1 },
  { section: '10.1', title: 'Disposition of patients', department: BS, figures_total: 31, figures_matched: 31, coverage_score: 5, needs_person: 0 },
  { section: '10.2', title: 'Demographic and baseline characteristics', department: BS, figures_total: 18, figures_matched: 18, coverage_score: 4, needs_person: 1 },
  { section: '11.3', title: 'Efficacy populations', department: BS, figures_total: 25, figures_matched: 25, coverage_score: 4, needs_person: 0 },
  { section: '11.4.1', title: 'ADAS-Cog primary endpoint', department: BS, figures_total: 13, figures_matched: 13, coverage_score: 4, needs_person: 2 },
  { section: '11.4.2', title: 'CIBIC+ primary endpoint', department: BS, figures_total: 11, figures_matched: 11, coverage_score: 4, needs_person: 1 },
  { section: '12.1', title: 'Extent of exposure', department: BS, figures_total: 14, figures_matched: 14, coverage_score: 5, needs_person: 0 },
  { section: '12.2', title: 'Adverse events', department: CS, figures_total: 20, figures_matched: 13, coverage_score: 4, needs_person: 0 },
  { section: '12.3', title: 'Deaths, serious and other significant adverse events', department: CS, figures_total: 27, figures_matched: 27, coverage_score: 3, needs_person: 3 },
  { section: '13', title: 'Discussion and overall conclusions', department: MW, figures_total: 0, figures_matched: 0, coverage_score: 3, needs_person: 4 },
];

export function scorecardFixture(redelivered: boolean): Scorecard {
  const rows: ScoreRow[] = BASE.map((r) => {
    const fixed = redelivered && r.section === '12.2';
    const matched = fixed ? r.figures_total : r.figures_matched;
    return { ...r, figures_matched: matched, status: matched < r.figures_total ? 'differs' : 'quiet' };
  });
  return {
    run: { run_id: 'fixture-run-0001', started_at: '2026-10-22T09:14:02Z', finished_at: '2026-10-22T09:17:06Z', wall_ms: 184000 },
    headline: {
      wall_ms: 184000,
      figures_total: rows.reduce((n, r) => n + r.figures_total, 0),
      figures_matched: rows.reduce((n, r) => n + r.figures_matched, 0),
      typed_figures: 0,
    },
    rows,
  };
}
