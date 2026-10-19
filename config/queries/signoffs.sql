-- Beat 4. Recorded sign-offs, newest first.
-- The analytics plugin caches results for an hour, keyed by parameters. The client sends a fresh
-- nonce per page load, so a reload (or scripts/reset_demo.py) always shows the table as it is.
-- @param nonce STRING = boot
SELECT sentence_id, action, reviewer, signed_at
FROM sean_zhang_catalog.rnd_regsub_review.review_signoffs
WHERE :nonce IS NOT NULL
ORDER BY signed_at DESC
