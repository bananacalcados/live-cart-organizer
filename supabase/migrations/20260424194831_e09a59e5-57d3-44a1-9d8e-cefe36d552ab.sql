SELECT net.http_post(
  url := 'https://tqxhcyuxgqbzqwoidpie.supabase.co/functions/v1/meta-capi-offline',
  headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'X-Internal-Secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'meta_capi_internal_secret' LIMIT 1)
  ),
  body := jsonb_build_object('sale_id', '992eab96-eafd-4f6c-bf85-7d8a666bb8a7')
) AS req_id;