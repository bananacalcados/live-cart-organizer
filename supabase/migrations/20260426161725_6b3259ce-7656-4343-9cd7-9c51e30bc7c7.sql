UPDATE live_campaign_dispatches
SET status = 'pending', error_message = NULL, locked_until = NULL, scheduled_at = now(), attempts = 0
WHERE status = 'failed'
  AND created_at > now() - interval '6 hours';