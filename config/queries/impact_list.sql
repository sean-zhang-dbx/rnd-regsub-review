-- Beat 1. Every changed cell of the certified table (version 3 vs current) joined to the
-- sentences that cite it. One row per changed figure per sentence.
WITH prev AS (
  SELECT row_key, stack(6,
    'n', CAST(n AS STRING), 'responders', CAST(responders AS STRING),
    'rate_pct', format_number(rate_pct, 1), 'diff_pct', format_number(diff_pct, 1),
    'ci_low', format_number(ci_low, 1), 'ci_high', format_number(ci_high, 1)
  ) AS (column_name, value_text)
  FROM sean_zhang_catalog.rnd_regsub_review.efficacy_primary VERSION AS OF 3
),
curr AS (
  SELECT row_key, stack(6,
    'n', CAST(n AS STRING), 'responders', CAST(responders AS STRING),
    'rate_pct', format_number(rate_pct, 1), 'diff_pct', format_number(diff_pct, 1),
    'ci_low', format_number(ci_low, 1), 'ci_high', format_number(ci_high, 1)
  ) AS (column_name, value_text)
  FROM sean_zhang_catalog.rnd_regsub_review.efficacy_primary
)
SELECT
  s.sentence_id,
  s.doc_type,
  s.section,
  s.section_title,
  s.seq,
  c.fig_key,
  p.value_text AS old_value,
  u.value_text AS new_value,
  CASE
    WHEN s.doc_type = 'label' THEN 'label'
    WHEN instr(lower(s.template), 'two-thirds') > 0 THEN 'prose'
    ELSE 'figure'
  END AS kind
FROM sean_zhang_catalog.rnd_regsub_review.figure_citations c
JOIN sean_zhang_catalog.rnd_regsub_review.document_sentences s ON s.sentence_id = c.sentence_id
JOIN prev p ON c.row_key = p.row_key AND c.column_name = p.column_name
JOIN curr u ON c.row_key = u.row_key AND c.column_name = u.column_name
WHERE c.source_table = 'efficacy_primary'
  AND NOT (p.value_text <=> u.value_text)
ORDER BY
  CASE s.doc_type WHEN 'csr' THEN 1 WHEN 'm27' THEN 2 WHEN 'm25' THEN 3 ELSE 4 END,
  s.seq,
  c.fig_key
