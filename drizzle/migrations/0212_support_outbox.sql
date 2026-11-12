CREATE TABLE public.support_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone text NOT NULL,
  whatsapp_number_id uuid NOT NULL REFERENCES public.whatsapp_numbers(id),
  text text NOT NULL CHECK (char_length(text) BETWEEN 1 AND 1000),
  link text,
  requested_by text NOT NULL DEFAULT 'assistant',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed','cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  error text,
  provider_message_id text,
  idempotency_key text UNIQUE,
  claimed_at timestamptz
);
CREATE INDEX support_outbox_pending_idx ON public.support_outbox(created_at,id) WHERE status='pending' AND claimed_at IS NULL;
CREATE INDEX support_outbox_sent_hour_idx ON public.support_outbox(sent_at) WHERE status='sent';
GRANT SELECT ON public.support_outbox TO authenticated;
GRANT ALL ON public.support_outbox TO service_role;
ALTER TABLE public.support_outbox ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff reads support outbox" ON public.support_outbox FOR SELECT TO authenticated USING (public.is_team_member(auth.uid()));

CREATE OR REPLACE FUNCTION public.support_outbox_enqueue(p_phone text,p_instance uuid,p_text text,p_link text DEFAULT NULL,p_requested_by text DEFAULT 'assistant',p_idempotency_key text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_id uuid; v_phone text:=regexp_replace(coalesce(p_phone,''),'\D','','g');
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' AND NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF p_instance NOT IN ('0833dc6c-6bd4-4b2f-8cb2-1889a5993e9c','ae453235-50e1-4ef6-8a87-8c8a77b2b440','1f715932-e118-4e88-8051-85a5c14f5a4b','c01d2777-df4c-4746-9433-d8c97c57d529') THEN RAISE EXCEPTION 'Instância não permitida para o assistente'; END IF;
  IF char_length(coalesce(p_text,''))<1 OR char_length(p_text)>1000 OR length(v_phone)<10 OR length(v_phone)>13 OR char_length(coalesce(p_link,''))>1000 OR coalesce(p_link,'')<>'' AND p_link!~'^https://' THEN RAISE EXCEPTION 'Dados inválidos para a caixa de saída'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.whatsapp_numbers WHERE id=p_instance AND is_active) THEN RAISE EXCEPTION 'Instância inativa'; END IF;
  IF p_idempotency_key IS NOT NULL THEN SELECT id INTO v_id FROM public.support_outbox WHERE idempotency_key=p_idempotency_key; IF v_id IS NOT NULL THEN RETURN v_id; END IF; END IF;
  INSERT INTO public.support_outbox(phone,whatsapp_number_id,text,link,requested_by,idempotency_key)
  VALUES(v_phone,p_instance,p_text,nullif(p_link,''),left(coalesce(nullif(p_requested_by,''),'assistant'),100),nullif(p_idempotency_key,''))
  ON CONFLICT (idempotency_key) DO NOTHING RETURNING id INTO v_id;
  IF v_id IS NULL THEN SELECT id INTO v_id FROM public.support_outbox WHERE idempotency_key=p_idempotency_key; END IF;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.support_outbox_enqueue(text,uuid,text,text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.support_outbox_enqueue(text,uuid,text,text,text,text) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.support_outbox_claim(p_limit integer DEFAULT 30)
RETURNS SETOF public.support_outbox LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_left integer; r public.support_outbox%ROWTYPE; n record;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'forbidden'; END IF;
  PERFORM pg_advisory_xact_lock(81726351);
  SELECT 30-count(*) INTO v_left FROM public.support_outbox WHERE status='sent' AND sent_at>=now()-interval '1 hour';
  IF v_left<=0 THEN RETURN; END IF;
  FOR r IN SELECT * FROM public.support_outbox
    WHERE status='pending' AND claimed_at IS NULL
      AND whatsapp_number_id IN ('0833dc6c-6bd4-4b2f-8cb2-1889a5993e9c','ae453235-50e1-4ef6-8a87-8c8a77b2b440','1f715932-e118-4e88-8051-85a5c14f5a4b','c01d2777-df4c-4746-9433-d8c97c57d529')
    ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT least(greatest(coalesce(p_limit,30),1),30,v_left)
  LOOP
    SELECT provider INTO n FROM public.whatsapp_numbers WHERE id=r.whatsapp_number_id AND is_active;
    IF NOT FOUND THEN
      UPDATE public.support_outbox SET status='failed',error='Instância inativa ou não permitida' WHERE id=r.id;
    ELSIF n.provider='meta' AND NOT EXISTS(SELECT 1 FROM public.whatsapp_messages m WHERE m.phone=r.phone AND m.whatsapp_number_id=r.whatsapp_number_id AND m.direction='incoming' AND m.created_at>=now()-interval '24 hours') THEN
      UPDATE public.support_outbox SET status='failed',error='Fora da janela de 24 horas da Meta: é necessária uma mensagem recente da cliente' WHERE id=r.id;
    ELSE
      UPDATE public.support_outbox SET claimed_at=now(),error=NULL WHERE id=r.id RETURNING * INTO r;
      RETURN NEXT r;
    END IF;
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.support_outbox_claim(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.support_outbox_claim(integer) TO service_role;