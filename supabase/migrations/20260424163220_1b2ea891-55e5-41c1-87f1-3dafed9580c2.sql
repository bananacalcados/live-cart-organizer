-- ============== Sales Triggers ==============
CREATE TABLE public.sales_triggers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  keywords text[] NOT NULL DEFAULT '{}',
  is_active boolean NOT NULL DEFAULT true,
  color text NOT NULL DEFAULT '#3B82F6',
  sort_order integer NOT NULL DEFAULT 0,
  ad_campaign_id uuid REFERENCES public.ad_campaigns_ai(id) ON DELETE SET NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_sales_triggers_active ON public.sales_triggers(is_active);
CREATE INDEX idx_sales_triggers_keywords ON public.sales_triggers USING gin(keywords);

ALTER TABLE public.sales_triggers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Auth read sales_triggers" ON public.sales_triggers FOR SELECT TO authenticated USING (true);
CREATE POLICY "Auth insert sales_triggers" ON public.sales_triggers FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Auth update sales_triggers" ON public.sales_triggers FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Auth delete sales_triggers" ON public.sales_triggers FOR DELETE TO authenticated USING (true);

CREATE TRIGGER tg_sales_triggers_updated BEFORE UPDATE ON public.sales_triggers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============== Trigger Messages (sequência) ==============
CREATE TABLE public.trigger_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trigger_id uuid NOT NULL REFERENCES public.sales_triggers(id) ON DELETE CASCADE,
  sort_order integer NOT NULL DEFAULT 0,
  delay_seconds integer NOT NULL DEFAULT 0,
  content text NOT NULL,
  media_type text,
  media_url text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_trigger_messages_trigger ON public.trigger_messages(trigger_id, sort_order);

ALTER TABLE public.trigger_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Auth read trigger_messages" ON public.trigger_messages FOR SELECT TO authenticated USING (true);
CREATE POLICY "Auth insert trigger_messages" ON public.trigger_messages FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Auth update trigger_messages" ON public.trigger_messages FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Auth delete trigger_messages" ON public.trigger_messages FOR DELETE TO authenticated USING (true);

CREATE TRIGGER tg_trigger_messages_updated BEFORE UPDATE ON public.trigger_messages
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============== Trigger Conversions ==============
CREATE TABLE public.trigger_conversions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trigger_id uuid REFERENCES public.sales_triggers(id) ON DELETE SET NULL,
  phone text NOT NULL,
  sale_value numeric(12,2) NOT NULL DEFAULT 0,
  sale_currency text NOT NULL DEFAULT 'BRL',
  finish_reason text,
  seller_id uuid,
  whatsapp_number_id uuid,
  meta_capi_event_id text,
  meta_capi_sent_at timestamptz,
  meta_capi_response jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_trigger_conversions_trigger ON public.trigger_conversions(trigger_id);
CREATE INDEX idx_trigger_conversions_phone ON public.trigger_conversions(phone);
CREATE INDEX idx_trigger_conversions_created ON public.trigger_conversions(created_at DESC);

ALTER TABLE public.trigger_conversions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Auth read trigger_conversions" ON public.trigger_conversions FOR SELECT TO authenticated USING (true);
CREATE POLICY "Auth insert trigger_conversions" ON public.trigger_conversions FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Auth update trigger_conversions" ON public.trigger_conversions FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- ============== Campos extras em chat_finished_conversations ==============
ALTER TABLE public.chat_finished_conversations
  ADD COLUMN IF NOT EXISTS sale_value numeric(12,2),
  ADD COLUMN IF NOT EXISTS sale_currency text DEFAULT 'BRL',
  ADD COLUMN IF NOT EXISTS trigger_id uuid REFERENCES public.sales_triggers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_chat_finished_trigger ON public.chat_finished_conversations(trigger_id);

-- ============== RPC: copiar mensagens entre triggers ==============
CREATE OR REPLACE FUNCTION public.copy_trigger_messages(p_source_trigger_id uuid, p_target_trigger_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  INSERT INTO public.trigger_messages (trigger_id, sort_order, delay_seconds, content, media_type, media_url, is_active)
  SELECT p_target_trigger_id, sort_order, delay_seconds, content, media_type, media_url, is_active
  FROM public.trigger_messages
  WHERE trigger_id = p_source_trigger_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;