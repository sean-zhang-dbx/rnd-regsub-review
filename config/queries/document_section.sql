-- Beats 2 and 3. All sentences of one section, one row per cited figure (plain prose sentences
-- come back once with a null fig_key). value_prev is the figure at version 3, value_curr is the
-- figure in the current certified table.
-- @param section STRING
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
  s.seq,
  s.template,
  s.text_v_prev,
  c.fig_key,
  c.citation_id,
  CASE WHEN c.source_table = 'efficacy_primary' THEN p.value_text ELSE c.value_text END AS value_prev,
  CASE WHEN c.source_table = 'efficacy_primary' THEN u.value_text ELSE c.value_text END AS value_curr,
  COALESCE(c.source_table = 'efficacy_primary' AND NOT (p.value_text <=> u.value_text), false) AS affected
FROM sean_zhang_catalog.rnd_regsub_review.document_sentences s
LEFT JOIN sean_zhang_catalog.rnd_regsub_review.figure_citations c ON c.sentence_id = s.sentence_id
LEFT JOIN prev p ON c.source_table = 'efficacy_primary' AND c.row_key = p.row_key AND c.column_name = p.column_name
LEFT JOIN curr u ON c.source_table = 'efficacy_primary' AND c.row_key = u.row_key AND c.column_name = u.column_name
WHERE s.section = :section
ORDER BY s.seq, c.citation_id
