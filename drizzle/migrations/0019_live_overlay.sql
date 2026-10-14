ALTER TABLE public.events ADD COLUMN IF NOT EXISTS overlay_token uuid DEFAULT gen_random_uuid();
UPDATE public.events SET overlay_token = gen_random_uuid() WHERE overlay_token IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS events_overlay_token_key ON public.events(overlay_token);

CREATE TABLE public.live_overlay_settings (
  event_id uuid PRIMARY KEY REFERENCES public.events(id) ON DELETE CASCADE,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  hidden boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.live_overlay_settings TO authenticated;
GRANT ALL ON public.live_overlay_settings TO service_role;
ALTER TABLE public.live_overlay_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth manage overlay settings" ON public.live_overlay_settings FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TABLE public.live_overlay_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.live_overlay_templates TO authenticated;
GRANT ALL ON public.live_overlay_templates TO service_role;
ALTER TABLE public.live_overlay_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth manage overlay templates" ON public.live_overlay_templates FOR ALL TO authenticated USING (true) WITH CHECK (true);

INSERT INTO public.live_overlay_templates (name, is_default, config) VALUES ('Padrão', true, jsonb_build_object(
  'ticker', jsonb_build_object('enabled', true, 'interval_seconds', 6, 'items', jsonb_build_array(
    jsonb_build_object('id','t1','text','🚚 Frete fixo R$ 19,99','enabled',true),
    jsonb_build_object('id','t2','text','💳 Parcele em até 10x sem juros','enabled',true),
    jsonb_build_object('id','t3','text','📍 Somos de Governador Valadares - MG','enabled',true),
    jsonb_build_object('id','t4','text','⏱️ Pague em até 20 minutos e participe do sorteio','enabled',true),
    jsonb_build_object('id','t5','text','💰 10% de cashback no segundo par','enabled',true))),
  'raffle_bar', jsonb_build_object('enabled', true, 'text_template', '🎁 {count} clientes já concorrem ao sorteio!', 'goal_enabled', false, 'goal_count', 50, 'goal_text', 'Faltam {remaining} para liberar o sorteio!'),
  'paid_alert', jsonb_build_object('enabled', true, 'template', '🎉 @{handle} garantiu {product}!', 'duration_seconds', 6),
  'assembled_alert', jsonb_build_object('enabled', true, 'template', '✅ @{handle}, seu pedido está pronto! Clique no botão para informar os dados de envio.', 'duration_seconds', 8),
  'cta', jsonb_build_object('enabled', true, 'interval_minutes', 10, 'items', jsonb_build_array(
    jsonb_build_object('id','c1','text','💬 Comente VIP e receba o link no direct','enabled',true)))
));

CREATE TABLE public.live_overlay_events (
  id bigserial PRIMARY KEY,
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('paid','assembled','cta_now','raffle_update')),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX live_overlay_events_event_id_idx ON public.live_overlay_events(event_id, id);
GRANT SELECT, INSERT ON public.live_overlay_events TO authenticated;
GRANT USAGE ON SEQUENCE public.live_overlay_events_id_seq TO authenticated;
GRANT ALL ON public.live_overlay_events TO service_role;
ALTER TABLE public.live_overlay_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read overlay events" ON public.live_overlay_events FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth insert cta" ON public.live_overlay_events FOR INSERT TO authenticated WITH CHECK (kind = 'cta_now');

CREATE OR REPLACE FUNCTION public.rotate_overlay_token(p_event_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v uuid := gen_random_uuid();
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;
  UPDATE events SET overlay_token = v WHERE id = p_event_id;
  RETURN v;
END $$;
REVOKE ALL ON FUNCTION public.rotate_overlay_token(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rotate_overlay_token(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.overlay_order_events()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_handle text;
BEGIN
  IF NEW.event_id IS NULL THEN RETURN NEW; END IF;
  SELECT ltrim(coalesce(instagram_handle,''),'@') INTO v_handle FROM customers WHERE id = NEW.customer_id;
  IF coalesce(NEW.is_paid,false) AND NOT coalesce(OLD.is_paid,false) THEN
    INSERT INTO live_overlay_events(event_id, kind, payload) VALUES (NEW.event_id, 'paid',
      jsonb_build_object('handle', coalesce(v_handle,''), 'product',
        coalesce(NEW.products->0->>'title', NEW.products->0->>'name', 'seu par')));
  END IF;
  IF NEW.stage = 'awaiting_confirmation' AND OLD.stage IS DISTINCT FROM 'awaiting_confirmation' THEN
    INSERT INTO live_overlay_events(event_id, kind, payload) VALUES (NEW.event_id, 'assembled', jsonb_build_object('handle', coalesce(v_handle,'')));
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN RETURN NEW;
END $$;

CREATE TRIGGER trg_overlay_order_events AFTER UPDATE OF is_paid, stage ON public.orders
FOR EACH ROW
WHEN ((NEW.is_paid IS DISTINCT FROM OLD.is_paid) OR (NEW.stage IS DISTINCT FROM OLD.stage))
EXECUTE FUNCTION public.overlay_order_events();

CREATE OR REPLACE FUNCTION public.overlay_raffle_count(p_event_id uuid)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce((SELECT count(*)::int FROM event_raffle_entries e
    WHERE e.raffle_id = (SELECT r.id FROM event_raffles r WHERE r.event_id = p_event_id AND r.status = 'draft' ORDER BY r.created_at DESC LIMIT 1)), 0)
$$;
REVOKE ALL ON FUNCTION public.overlay_raffle_count(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.overlay_raffle_count(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.overlay_pull(p_token uuid, p_after_id bigint DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_event uuid; v_after bigint := coalesce(p_after_id, 0);
BEGIN
  SELECT id INTO v_event FROM events WHERE overlay_token = p_token;
  IF v_event IS NULL THEN RETURN jsonb_build_object('error','invalid_token'); END IF;
  -- Primeira leitura: não reprocessa histórico, só marca o último id.
  IF v_after <= 0 THEN
    SELECT coalesce(max(id),0) INTO v_after FROM live_overlay_events WHERE event_id = v_event;
  END IF;
  RETURN jsonb_build_object(
    'settings', (SELECT jsonb_build_object('config', config, 'hidden', hidden) FROM live_overlay_settings WHERE event_id = v_event),
    'raffle_count', public.overlay_raffle_count(v_event),
    'last_id', v_after,
    'events', coalesce((SELECT jsonb_agg(x ORDER BY x.id) FROM (
        SELECT id, kind, payload, created_at FROM live_overlay_events
        WHERE event_id = v_event AND id > v_after ORDER BY id LIMIT 50) x), '[]'::jsonb)
  );
END $$;
REVOKE ALL ON FUNCTION public.overlay_pull(uuid, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.overlay_pull(uuid, bigint) TO anon, authenticated;