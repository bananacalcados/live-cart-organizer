ALTER TABLE public.selfservice_message_queue ADD COLUMN claimed_at timestamptz;

CREATE OR REPLACE FUNCTION public.selfservice_queue_claim(p_limit integer DEFAULT 20)
RETURNS SETOF public.selfservice_message_queue
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  UPDATE public.selfservice_message_queue q
     SET status = 'sending', claimed_at = now()
   WHERE q.id IN (
     SELECT id FROM public.selfservice_message_queue
      WHERE (status = 'pending' AND next_attempt_at <= now())
         OR (status = 'sending' AND claimed_at < now() - interval '10 minutes')
      ORDER BY created_at
      LIMIT LEAST(GREATEST(p_limit, 1), 50)
      FOR UPDATE SKIP LOCKED
   )
  RETURNING q.*;
$function$;