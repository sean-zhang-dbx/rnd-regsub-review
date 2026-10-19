-- Beat 4. Recorded sign-offs, newest first.
SELECT sentence_id, action, reviewer, signed_at
FROM sean_zhang_catalog.rnd_regsub_review.review_signoffs
ORDER BY signed_at DESC
