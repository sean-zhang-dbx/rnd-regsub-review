-- Beat 1. Cited sentences whose cited cells did not change between version 3 and the current version
-- (here the safety sentences, which cite safety_overview).
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
),
flagged AS (
  SELECT c.sentence_id, c.source_table,
         (c.source_table = 'efficacy_primary' AND NOT (p.value_text <=> u.value_text)) AS affected
  FROM sean_zhang_catalog.rnd_regsub_review.figure_citations c
  LEFT JOIN prev p ON c.row_key = p.row_key AND c.column_name = p.column_name
  LEFT JOIN curr u ON c.row_key = u.row_key AND c.column_name = u.column_name
)
SELECT s.sentence_id, s.doc_type, s.section, MAX(f.source_table) AS source_table
FROM flagged f
JOIN sean_zhang_catalog.rnd_regsub_review.document_sentences s ON s.sentence_id = f.sentence_id
GROUP BY s.sentence_id, s.doc_type, s.section, s.seq
HAVING MAX(CAST(COALESCE(f.affected, false) AS INT)) = 0
ORDER BY CASE s.doc_type WHEN 'csr' THEN 1 WHEN 'm27' THEN 2 WHEN 'm25' THEN 3 ELSE 4 END, s.seq
