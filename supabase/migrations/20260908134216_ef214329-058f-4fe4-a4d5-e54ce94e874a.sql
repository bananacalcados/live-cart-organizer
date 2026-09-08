DO $$ BEGIN PERFORM cron.unschedule('instagram-token-refresh-daily'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
SELECT cron.schedule(
  'instagram-token-refresh-daily',
  '20 7 * * *',
  $$
  SELECT net.http_post(
    url := 'https://tqxhcyuxgqbzqwoidpie.supabase.co/functions/v1/instagram-token-refresh',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',(SELECT value FROM public.internal_function_secrets WHERE key='cron_secret' LIMIT 1)),
    body := '{}'::jsonb
  );
  $$
);