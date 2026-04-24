-- 1) Clear failed log for the recent Kyssila sale
DELETE FROM public.meta_capi_offline_log
WHERE sale_id = '992eab96-eafd-4f6c-bf85-7d8a666bb8a7'
  AND event_name = 'Purchase'
  AND status = 'error';

-- 2) Re-trigger
UPDATE public.pos_sales SET updated_at = now()
WHERE id = '992eab96-eafd-4f6c-bf85-7d8a666bb8a7';

-- 3) Fire the historical backfill (90 days, real send)
SELECT net.http_post(
  url := 'https://tqxhcyuxgqbzqwoidpie.supabase.co/functions/v1/meta-capi-offline-backfill',
  headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'X-Internal-Secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'meta_capi_internal_secret' LIMIT 1)
  ),
  body := jsonb_build_object('days', 90, 'dry_run', false, 'limit', 5000),
  timeout_milliseconds := 600000
) AS backfill_request_id;