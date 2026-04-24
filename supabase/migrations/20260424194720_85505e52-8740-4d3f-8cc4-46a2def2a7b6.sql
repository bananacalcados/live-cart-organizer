SELECT net.http_post(
  url := 'https://tqxhcyuxgqbzqwoidpie.supabase.co/functions/v1/meta-capi-offline-backfill',
  headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'X-Internal-Secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'meta_capi_internal_secret' LIMIT 1)
  ),
  body := jsonb_build_object('days', 90, 'dry_run', false, 'limit', 10000),
  timeout_milliseconds := 600000
) AS backfill_request_id;