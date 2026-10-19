-- Beats 2 and 3. Table 14.2.1 as the TLF pane shows it: every cell of efficacy_primary at
-- version 3 and in the current certified table, one row per cell.
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
SELECT u.row_key, u.column_name, p.value_text AS value_prev, u.value_text AS value_curr
FROM curr u
LEFT JOIN prev p ON p.row_key = u.row_key AND p.column_name = u.column_name
ORDER BY u.row_key, u.column_name
