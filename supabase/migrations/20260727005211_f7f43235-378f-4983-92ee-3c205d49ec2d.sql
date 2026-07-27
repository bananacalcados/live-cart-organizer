DO $$
DECLARE s text; r bigint;
BEGIN
  SELECT decrypted_secret INTO s FROM vault.decrypted_secrets WHERE name='meta_capi_internal_secret' LIMIT 1;
  SELECT net.http_post(
    url := 'https://tqxhcyuxgqbzqwoidpie.supabase.co/functions/v1/meta-capi-offline',
    headers := jsonb_build_object('Content-Type','application/json','X-Internal-Secret', s),
    body := jsonb_build_object('sale_id','51b3d1d8-12a7-4641-ad10-45eea443ab06','source','verify')
  ) INTO r;
END $$;