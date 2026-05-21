
SELECT cron.unschedule('archive-individual-messages-30d');
SELECT cron.schedule(
  'archive-individual-messages-30d',
  '30 4 * * *',
  $$ SELECT public.archive_old_messages_individual(30, 20000, 5); $$
);
