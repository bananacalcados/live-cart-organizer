CREATE TABLE public.event_bulk_sends (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('template','crossell')),
  template_name text NOT NULL,
  template_language text NOT NULL DEFAULT 'pt_BR',
  template_label text,
  whatsapp_number_id uuid,
  stages text[] NOT NULL DEFAULT '{}',
  variable_map jsonb NOT NULL DEFAULT '{}'::jsonb,
  base_components jsonb NOT NULL DEFAULT '[]'::jsonb,
  allow_resend boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','processing','done','cancelled')),
  total_count integer NOT NULL DEFAULT 0,
  sent_count integer NOT NULL DEFAULT 0,
  failed_count integer NOT NULL DEFAULT 0,
  skipped_count integer NOT NULL DEFAULT 0,
  created_by uuid,
  created_by_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_bulk_sends TO authenticated;
GRANT ALL ON public.event_bulk_sends TO service_role;
ALTER TABLE public.event_bulk_sends ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated manage event bulk sends" ON public.event_bulk_sends
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE INDEX idx_event_bulk_sends_event ON public.event_bulk_sends(event_id, created_at DESC);
CREATE TRIGGER trg_event_bulk_sends_updated_at BEFORE UPDATE ON public.event_bulk_sends
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.event_bulk_send_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  send_id uuid NOT NULL REFERENCES public.event_bulk_sends(id) ON DELETE CASCADE,
  order_id uuid,
  phone text NOT NULL,
  customer_name text,
  whatsapp_number_id uuid,
  components jsonb NOT NULL DEFAULT '[]'::jsonb,
  rendered_message text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed','skipped')),
  reason text,
  message_id text,
  attempts integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (send_id, phone)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_bulk_send_items TO authenticated;
GRANT ALL ON public.event_bulk_send_items TO service_role;
ALTER TABLE public.event_bulk_send_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated manage event bulk send items" ON public.event_bulk_send_items
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE INDEX idx_event_bulk_send_items_pending ON public.event_bulk_send_items(status, created_at) WHERE status = 'pending';
CREATE INDEX idx_event_bulk_send_items_send ON public.event_bulk_send_items(send_id);
CREATE INDEX idx_event_bulk_send_items_phone ON public.event_bulk_send_items(phone);
CREATE TRIGGER trg_event_bulk_send_items_updated_at BEFORE UPDATE ON public.event_bulk_send_items
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Claim atômico de itens pendentes (SKIP LOCKED evita envio duplicado entre workers)
CREATE OR REPLACE FUNCTION public.claim_event_bulk_send_items(p_limit integer DEFAULT 20, p_lock_seconds integer DEFAULT 120)
RETURNS SETOF public.event_bulk_send_items
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH picked AS (
    SELECT i.id
    FROM public.event_bulk_send_items i
    JOIN public.event_bulk_sends s ON s.id = i.send_id
    WHERE i.status = 'pending'
      AND s.status IN ('queued','processing')
      AND (i.locked_until IS NULL OR i.locked_until < now())
    ORDER BY i.created_at
    LIMIT p_limit
    FOR UPDATE OF i SKIP LOCKED
  )
  UPDATE public.event_bulk_send_items i
  SET locked_until = now() + make_interval(secs => p_lock_seconds),
      attempts = i.attempts + 1
  FROM picked
  WHERE i.id = picked.id
  RETURNING i.*;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_event_bulk_send_items(integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_event_bulk_send_items(integer, integer) TO service_role;

-- Recalcula contadores e status do disparo a partir dos itens
CREATE OR REPLACE FUNCTION public.refresh_event_bulk_send_counts(p_send_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total int; v_sent int; v_failed int; v_skipped int; v_pending int;
BEGIN
  SELECT count(*),
         count(*) FILTER (WHERE status='sent'),
         count(*) FILTER (WHERE status='failed'),
         count(*) FILTER (WHERE status='skipped'),
         count(*) FILTER (WHERE status='pending')
  INTO v_total, v_sent, v_failed, v_skipped, v_pending
  FROM public.event_bulk_send_items WHERE send_id = p_send_id;

  UPDATE public.event_bulk_sends
  SET total_count = v_total, sent_count = v_sent, failed_count = v_failed, skipped_count = v_skipped,
      status = CASE WHEN status = 'cancelled' THEN 'cancelled'
                    WHEN v_pending = 0 THEN 'done'
                    ELSE 'processing' END
  WHERE id = p_send_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.refresh_event_bulk_send_counts(uuid) TO service_role, authenticated;

ALTER PUBLICATION supabase_realtime ADD TABLE public.event_bulk_sends;
ALTER PUBLICATION supabase_realtime ADD TABLE public.event_bulk_send_items;