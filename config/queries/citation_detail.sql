-- Beat 2. The citation card: which certified cell a figure came from, and the query that reads it.
-- @param citation_id STRING
SELECT
  c.source_table,
  c.row_key,
  c.column_name,
  c.table_version,
  c.query_key,
  CASE
    WHEN c.source_table = 'safety_overview' AND c.fig_key RLIKE '_pct$'
      THEN concat('SELECT ROUND(100 * ', c.column_name, ' / n, 1) AS value FROM sean_zhang_catalog.rnd_regsub_review.',
                  c.source_table, ' VERSION AS OF ', CAST(c.table_version AS STRING),
                  ' WHERE row_key = ', chr(39), c.row_key, chr(39))
    ELSE concat('SELECT ', c.column_name, ' AS value FROM sean_zhang_catalog.rnd_regsub_review.',
                c.source_table, ' VERSION AS OF ', CAST(c.table_version AS STRING),
                ' WHERE row_key = ', chr(39), c.row_key, chr(39))
  END AS query_sql,
  c.certified_by,
  c.certified_at
FROM sean_zhang_catalog.rnd_regsub_review.figure_citations c
WHERE c.citation_id = :citation_id
