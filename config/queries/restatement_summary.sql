-- Beat 1. What changed between the last two versions of the certified table.
-- The business time of the restatement is in the version commit's userMetadata, because Delta commit
-- timestamps cannot be backdated.
WITH latest AS (
  SELECT version, userMetadata
  FROM (DESCRIBE HISTORY sean_zhang_catalog.rnd_regsub_review.efficacy_primary)
  WHERE userMetadata IS NOT NULL
  ORDER BY version DESC
  LIMIT 1
),
prev AS (
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
changed AS (
  SELECT COUNT(*) AS changed_cells
  FROM prev p JOIN curr c ON p.row_key = c.row_key AND p.column_name = c.column_name
  WHERE NOT (p.value_text <=> c.value_text)
)
SELECT
  'efficacy_primary' AS table_name,
  CAST(latest.version - 1 AS BIGINT) AS prev_version,
  CAST(latest.version AS BIGINT) AS curr_version,
  CAST(get_json_object(latest.userMetadata, '$.restated_at') AS TIMESTAMP) AS restated_at,
  get_json_object(latest.userMetadata, '$.restated_by') AS restated_by,
  CAST(changed.changed_cells AS INT) AS changed_cells
FROM latest CROSS JOIN changed
