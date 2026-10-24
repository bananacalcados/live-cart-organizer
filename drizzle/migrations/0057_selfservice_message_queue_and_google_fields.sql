
-- Bloco 4: selo do Google configurável por evento (nota + link do perfil).
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS google_rating_text text,
  ADD COLUMN IF NOT EXISTS google_profile_url text;

-- Bloco 2: fila persistida de mensagens automáticas do modo whatsapp_autoatendimento.
CREATE TABLE IF NOT EXISTS public.selfservice_message_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_key text NOT NULL UNIQUE,
  event_id uuid,
  order_id uuid,
  kind text NOT NULL,
  phone text NOT NULL,
  whatsapp_number_id uuid,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);
CREATE INDEX IF NOT EXISTS selfservice_queue_due_idx ON public.selfservice_message_queue (status, next_attempt_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS selfservice_queue_event_idx ON public.selfservice_message_queue (event_id, status);

GRANT SELECT ON public.selfservice_message_queue TO authenticated;
GRANT ALL ON public.selfservice_message_queue TO service_role;

ALTER TABLE public.selfservice_message_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Equipe lê a fila do autoatendimento"
  ON public.selfservice_message_queue FOR SELECT TO authenticated USING (true);

-- Ritmo por instância: no mínimo 4 s entre mensagens do MESMO número remetente.
CREATE TABLE IF NOT EXISTS public.selfservice_instance_pacing (
  whatsapp_number_id text PRIMARY KEY,
  last_sent_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.selfservice_instance_pacing TO service_role;

-- Enfileira (idempotente pela message_key: pedido + tipo). Retorna true se entrou na fila.
CREATE OR REPLACE FUNCTION public.selfservice_queue_enqueue(
  p_message_key text, p_event_id uuid, p_order_id uuid, p_kind text,
  p_phone text, p_whatsapp_number_id uuid, p_payload jsonb
) RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO public.selfservice_message_queue
    (message_key, event_id, order_id, kind, phone, whatsapp_number_id, payload)
  VALUES (p_message_key, p_event_id, p_order_id, p_kind, p_phone, p_whatsapp_number_id, COALESCE(p_payload, '{}'::jsonb))
  ON CONFLICT (message_key) DO NOTHING
  RETURNING true;
$$;
REVOKE ALL ON FUNCTION public.selfservice_queue_enqueue(text, uuid, uuid, text, text, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.selfservice_queue_enqueue(text, uuid, uuid, text, text, uuid, jsonb) TO service_role;

-- Reserva mensagens vencidas para envio (uma de cada vez por worker, sem travar as demais).
CREATE OR REPLACE FUNCTION public.selfservice_queue_claim(p_limit integer DEFAULT 20)
RETURNS SETOF public.selfservice_message_queue
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.selfservice_message_queue q
     SET status = 'sending'
   WHERE q.id IN (
     SELECT id FROM public.selfservice_message_queue
      WHERE status = 'pending' AND next_attempt_at <= now()
      ORDER BY created_at
      LIMIT LEAST(GREATEST(p_limit, 1), 50)
      FOR UPDATE SKIP LOCKED
   )
  RETURNING q.*;
$$;
REVOKE ALL ON FUNCTION public.selfservice_queue_claim(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.selfservice_queue_claim(integer) TO service_role;

-- Portão de ritmo por instância: só libera se a última mensagem dessa instância foi há >= p_min_ms.
CREATE OR REPLACE FUNCTION public.selfservice_instance_gate(p_number_id text, p_min_ms integer)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO public.selfservice_instance_pacing (whatsapp_number_id, last_sent_at)
  VALUES (COALESCE(p_number_id, 'sem-instancia'), now())
  ON CONFLICT (whatsapp_number_id) DO UPDATE
     SET last_sent_at = now()
   WHERE public.selfservice_instance_pacing.last_sent_at <= now() - make_interval(secs => GREATEST(p_min_ms, 0) / 1000.0)
  RETURNING true;
$$;
REVOKE ALL ON FUNCTION public.selfservice_instance_gate(text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.selfservice_instance_gate(text, integer) TO service_role;

-- Reenvio manual pela Central da Live: volta a mensagem para a fila.
CREATE OR REPLACE FUNCTION public.selfservice_queue_requeue(p_id uuid)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.selfservice_message_queue
     SET status = 'pending', attempts = 0, next_attempt_at = now(), last_error = NULL
   WHERE id = p_id AND status = 'failed'
  RETURNING true;
$$;
REVOKE ALL ON FUNCTION public.selfservice_queue_requeue(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.selfservice_queue_requeue(uuid) TO authenticated, service_role;
