-- Beat 3 (hero). Recompute every cited efficacy figure live from the current certified table.
WITH curr AS (
  SELECT row_key, stack(6,
    'n', CAST(n AS STRING), 'responders', CAST(responders AS STRING),
    'rate_pct', format_number(rate_pct, 1), 'diff_pct', format_number(diff_pct, 1),
    'ci_low', format_number(ci_low, 1), 'ci_high', format_number(ci_high, 1)
  ) AS (column_name, value_text)
  FROM sean_zhang_catalog.rnd_regsub_review.efficacy_primary
),
v AS (
  SELECT CAST(MAX(version) AS BIGINT) AS source_version
  FROM (DESCRIBE HISTORY sean_zhang_catalog.rnd_regsub_review.efficacy_primary)
),
cited AS (
  SELECT DISTINCT fig_key, row_key, column_name
  FROM sean_zhang_catalog.rnd_regsub_review.figure_citations
  WHERE source_table = 'efficacy_primary'
)
SELECT cited.fig_key AS fig_key, curr.value_text AS value, v.source_version AS source_version
FROM cited
JOIN curr ON cited.row_key = curr.row_key AND cited.column_name = curr.column_name
CROSS JOIN v
ORDER BY cited.fig_key
