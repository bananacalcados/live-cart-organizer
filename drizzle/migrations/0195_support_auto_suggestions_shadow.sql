-- Fase 4: respostas automáticas de troca/devolução em MODO SOMBRA (nada é enviado pelo banco).
ALTER TABLE public.support_settings
  ADD COLUMN IF NOT EXISTS auto_reply_mode text NOT NULL DEFAULT 'shadow',
  ADD COLUMN IF NOT EXISTS auto_reply_instance_ids uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS support_whatsapp_phone text,
  ADD COLUMN IF NOT EXISTS auto_reply_cooldown_hours integer NOT NULL DEFAULT 24,
  ADD COLUMN IF NOT EXISTS auto_reply_min_delay_s integer NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS auto_reply_max_delay_s integer NOT NULL DEFAULT 60;
ALTER TABLE public.support_settings ADD CONSTRAINT support_settings_auto_reply_mode_chk CHECK (auto_reply_mode IN ('off','shadow','auto'));

CREATE TABLE public.support_auto_suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  message_row_id uuid UNIQUE,
  whatsapp_number_id uuid,
  channel text NOT NULL DEFAULT 'whatsapp',
  phone text NOT NULL,
  customer_name text,
  incoming_text text,
  intent text NOT NULL CHECK (intent IN ('troca','devolucao','indefinido')),
  sale_id uuid,
  sale_channel text,
  decision text NOT NULL CHECK (decision IN ('enviar_link','presencial','instagram_whatsapp','fila')),
  reason text NOT NULL,
  link_type text CHECK (link_type IN ('troca','devolucao')),
  suggested_text text,
  wa_me_url text,
  mode_at_creation text NOT NULL,
  auto_send_after timestamptz,
  status text NOT NULL DEFAULT 'nova' CHECK (status IN ('nova','enviada','descartada')),
  sent_text text, sent_link_id uuid, sent_by uuid, sent_at timestamptz,
  discard_reason text, discarded_by uuid, discarded_at timestamptz,
  wrong_suggestion boolean NOT NULL DEFAULT false
);
CREATE INDEX support_auto_suggestions_status_created ON public.support_auto_suggestions (status, created_at DESC);
CREATE INDEX support_auto_suggestions_phone_inst ON public.support_auto_suggestions (phone, whatsapp_number_id, created_at DESC);
GRANT SELECT ON public.support_auto_suggestions TO authenticated;
GRANT ALL ON public.support_auto_suggestions TO service_role;
ALTER TABLE public.support_auto_suggestions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "desk staff reads suggestions" ON public.support_auto_suggestions FOR SELECT TO authenticated
  USING (public._exchange_desk_staff(auth.uid()));

-- Classificação por palavras (espelhada em src/lib/supportAuto/intent.ts).
CREATE OR REPLACE FUNCTION public.support_normalize_text(p text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT regexp_replace(translate(lower(coalesce(p,'')), 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc'), '\s+', ' ', 'g')
$$;
CREATE OR REPLACE FUNCTION public.support_classify_intent(p text) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public' AS $$
DECLARE t text := public.support_normalize_text(p); v_troca boolean; v_dev boolean;
BEGIN
  v_troca := t ~ '\m(tro[ck]a\w*|tro[ck]ar\w*|tro[ck]o|tro[ck]ei)\M'
          OR t ~ '\moutr[oa] (numero|numeracao|tamanho|n)\M'
          OR t ~ '\mnumeracao\M'
          OR t ~ '\mnao (me )?(serviu|servio|servil|coube)\M'
          OR t ~ '\mficou (muito |bem |um pouco )?(grande|pequen\w*|apertad\w*|larg\w*|folgad\w*)'
          OR t ~ '\mtamanho errado\M';
  v_dev := t ~ '\m(devol\w*|devou\w*|devolv\w*)'
          OR t ~ '\mreembols\w*'
          OR t ~ '\mestorn\w*'
          OR t ~ '\mdinheiro de volta\M'
          OR t ~ '\marrepend\w*'
          OR t ~ '\mcancelar (o |meu |a )?(pedido|compra)\M';
  IF v_troca AND v_dev THEN RETURN 'indefinido'; END IF;
  IF v_troca THEN RETURN 'troca'; END IF;
  IF v_dev THEN RETURN 'devolucao'; END IF;
  RETURN NULL;
END $$;
GRANT EXECUTE ON FUNCTION public.support_normalize_text(text), public.support_classify_intent(text) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.support_normalize_text(text), public.support_classify_intent(text) FROM anon;

-- Decisão + registro (nunca envia nada; só grava a sugestão).
CREATE OR REPLACE FUNCTION public.support_auto_evaluate(p_message_row_id uuid, p_phone text, p_number_id uuid, p_channel text, p_text text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  st public.support_settings%ROWTYPE; v_intent text; v_s8 text; v_online int; v_pres int; v_sale record;
  v_deliv timestamptz; v_days int; v_decision text; v_reason text; v_link text; v_name text; v_id uuid; v_wa text;
BEGIN
  SELECT * INTO st FROM public.support_settings LIMIT 1;
  IF st.auto_reply_mode IS NULL OR st.auto_reply_mode = 'off' THEN RETURN NULL; END IF;
  IF p_number_id IS NULL OR NOT (p_number_id = ANY(st.auto_reply_instance_ids)) THEN RETURN NULL; END IF;
  v_intent := public.support_classify_intent(p_text);
  IF v_intent IS NULL THEN RETURN NULL; END IF;
  -- atendente humano respondeu nas últimas 2h
  IF EXISTS (SELECT 1 FROM public.whatsapp_messages m WHERE m.phone = p_phone AND m.whatsapp_number_id = p_number_id
             AND m.direction = 'outgoing' AND m.sender_user_id IS NOT NULL AND m.created_at > now() - interval '2 hours') THEN RETURN NULL; END IF;
  -- uma sugestão aberta por conversa a cada 24h
  IF EXISTS (SELECT 1 FROM public.support_auto_suggestions s WHERE s.phone = p_phone AND s.whatsapp_number_id = p_number_id
             AND s.status = 'nova' AND s.created_at > now() - interval '24 hours') THEN RETURN NULL; END IF;

  IF coalesce(p_channel,'whatsapp') = 'instagram' THEN
    v_wa := NULLIF(regexp_replace(coalesce(st.support_whatsapp_phone,''),'\D','','g'),'');
    IF v_intent = 'indefinido' THEN v_decision := 'fila'; v_reason := 'intencao_indefinida';
    ELSIF v_wa IS NULL THEN v_decision := 'fila'; v_reason := 'numero_atendimento_nao_configurado';
    ELSE
      v_decision := 'instagram_whatsapp'; v_reason := 'instagram_para_whatsapp';
      v_wa := 'https://wa.me/' || v_wa || '?text=' || replace(CASE WHEN v_intent='troca' THEN 'Olá! Quero trocar meu pedido' ELSE 'Olá! Quero devolver meu pedido' END, ' ', '%20');
    END IF;
    INSERT INTO public.support_auto_suggestions(message_row_id, whatsapp_number_id, channel, phone, incoming_text, intent, decision, reason, suggested_text, wa_me_url, mode_at_creation)
    VALUES (p_message_row_id, p_number_id, 'instagram', p_phone, left(p_text,1000), v_intent, v_decision, v_reason,
      CASE WHEN v_decision='instagram_whatsapp' THEN 'Oi! Pra agilizar sua ' || CASE WHEN v_intent='troca' THEN 'troca' ELSE 'devolução' END || ', fala com a gente no WhatsApp por este link: ' || v_wa END,
      CASE WHEN v_decision='instagram_whatsapp' THEN v_wa END, st.auto_reply_mode)
    ON CONFLICT (message_row_id) DO NOTHING RETURNING id INTO v_id;
    RETURN v_id;
  END IF;

  v_s8 := right(regexp_replace(coalesce(p_phone,''),'\D','','g'), 8);
  IF length(v_s8) < 8 THEN RETURN NULL; END IF;
  SELECT count(*) FILTER (WHERE sales_channel IN ('site','live','link_online','whatsapp')),
         count(*) FILTER (WHERE coalesce(sales_channel,'presencial') NOT IN ('site','live','link_online','whatsapp'))
    INTO v_online, v_pres
  FROM public.pos_sales
  WHERE phone_suffix8 = v_s8 AND created_at > now() - interval '60 days'
    AND status IN ('completed','paid') AND status_cancelamento::text <> 'cancelado';

  IF v_online = 1 THEN
    SELECT id, sales_channel, customer_name INTO v_sale FROM public.pos_sales
     WHERE phone_suffix8 = v_s8 AND created_at > now() - interval '60 days' AND status IN ('completed','paid')
       AND status_cancelamento::text <> 'cancelado' AND sales_channel IN ('site','live','link_online','whatsapp') LIMIT 1;
  ELSE
    SELECT id, sales_channel, customer_name INTO v_sale FROM public.pos_sales
     WHERE phone_suffix8 = v_s8 AND created_at > now() - interval '60 days' AND status IN ('completed','paid')
       AND status_cancelamento::text <> 'cancelado' ORDER BY created_at DESC LIMIT 1;
  END IF;
  v_name := split_part(btrim(coalesce(v_sale.customer_name,'')),' ',1);

  IF v_online = 0 AND v_pres > 0 THEN v_decision := 'presencial'; v_reason := 'compra_na_loja';
  ELSIF v_online = 0 THEN v_decision := 'fila'; v_reason := 'nenhum_pedido';
  ELSIF v_online > 1 THEN v_decision := 'fila'; v_reason := 'varios_pedidos';
  ELSIF v_intent = 'indefinido' THEN v_decision := 'fila'; v_reason := 'intencao_indefinida';
  ELSE
    SELECT delivered_at INTO v_deliv FROM public.shipment_simulations WHERE sale_id = v_sale.id AND merged_into_id IS NULL ORDER BY created_at DESC LIMIT 1;
    v_days := CASE WHEN v_intent='troca' THEN st.exchange_window_days ELSE st.return_window_days END;
    IF v_deliv IS NULL THEN v_decision := 'fila'; v_reason := 'entrega_sem_confirmacao';
    ELSIF now() > v_deliv + make_interval(days => coalesce(v_days,7)) THEN v_decision := 'fila'; v_reason := 'fora_do_prazo';
    ELSE v_decision := 'enviar_link'; v_reason := 'um_pedido_elegivel'; v_link := v_intent; END IF;
  END IF;

  INSERT INTO public.support_auto_suggestions(message_row_id, whatsapp_number_id, channel, phone, customer_name, incoming_text, intent,
    sale_id, sale_channel, decision, reason, link_type, suggested_text, mode_at_creation, auto_send_after)
  VALUES (p_message_row_id, p_number_id, 'whatsapp', p_phone, NULLIF(v_name,''), left(p_text,1000), v_intent,
    v_sale.id, v_sale.sales_channel, v_decision, v_reason, v_link,
    CASE v_decision
      WHEN 'enviar_link' THEN 'Oi' || coalesce(' '||NULLIF(v_name,''),'') || '! Pra fazer sua ' || CASE WHEN v_intent='troca' THEN 'troca' ELSE 'devolução' END || ' é só abrir este link e seguir os passos: {{link}}'
      WHEN 'presencial' THEN 'Oi' || coalesce(' '||NULLIF(v_name,''),'') || '! Compras feitas na loja são trocadas lá mesmo, pessoalmente. É só levar o produto com a etiqueta e a nota 😊'
    END,
    st.auto_reply_mode,
    CASE WHEN v_decision='enviar_link' THEN now() + make_interval(secs => st.auto_reply_min_delay_s + floor(random()*(greatest(st.auto_reply_max_delay_s - st.auto_reply_min_delay_s,0)+1))) END)
  ON CONFLICT (message_row_id) DO NOTHING RETURNING id INTO v_id;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.support_auto_evaluate(uuid,text,uuid,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.support_auto_evaluate(uuid,text,uuid,text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.support_auto_detect_trigger() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  BEGIN
    PERFORM public.support_auto_evaluate(NEW.id, NEW.phone, NEW.whatsapp_number_id, NEW.channel, NEW.message);
  EXCEPTION WHEN others THEN
    RAISE WARNING 'support_auto_detect: %', SQLERRM; -- nunca bloqueia a mensagem
  END;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.support_auto_detect_trigger() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_support_auto_detect AFTER INSERT ON public.whatsapp_messages FOR EACH ROW
  WHEN (NEW.direction = 'incoming' AND NEW.is_group IS NOT TRUE AND NEW.message IS NOT NULL
        AND NEW.message ~* '(tro[ck]|devo|reembol|estorn|volta|arrepend|n[uú]mer|serv|coube|ficou|tamanho|cancel)')
  EXECUTE FUNCTION public.support_auto_detect_trigger();

-- Portão do modo automático (pronto, não ligado; não existe rotina que envie).
CREATE OR REPLACE FUNCTION public.support_auto_reply_can_send(p_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.support_auto_suggestions s, public.support_settings st
    WHERE s.id = p_id AND s.status = 'nova' AND s.decision = 'enviar_link'
      AND st.auto_reply_mode = 'auto' AND st.central_public_enabled
      AND s.auto_send_after IS NOT NULL AND now() >= s.auto_send_after
      AND EXISTS (SELECT 1 FROM public.whatsapp_messages m WHERE m.phone = s.phone AND m.whatsapp_number_id = s.whatsapp_number_id
                  AND m.direction='incoming' AND m.created_at > now() - interval '24 hours')
      AND NOT EXISTS (SELECT 1 FROM public.support_auto_suggestions o WHERE o.phone = s.phone AND o.whatsapp_number_id = s.whatsapp_number_id
                  AND o.status='enviada' AND o.sent_by IS NULL AND o.sent_at > now() - make_interval(hours => st.auto_reply_cooldown_hours)))
$$;
REVOKE ALL ON FUNCTION public.support_auto_reply_can_send(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.support_auto_reply_can_send(uuid) TO service_role;

-- RPCs do painel
CREATE OR REPLACE FUNCTION public.support_suggestions_list(p_status text DEFAULT 'nova', p_limit int DEFAULT 50, p_offset int DEFAULT 0)
RETURNS SETOF public.support_auto_suggestions LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT public._exchange_desk_staff(auth.uid()) THEN RAISE EXCEPTION 'forbidden'; END IF;
  RETURN QUERY SELECT * FROM public.support_auto_suggestions WHERE status = coalesce(p_status,'nova')
    ORDER BY created_at DESC LIMIT least(greatest(coalesce(p_limit,50),1),200) OFFSET greatest(coalesce(p_offset,0),0);
END $$;

CREATE OR REPLACE FUNCTION public.support_suggestion_prepare_link(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE s public.support_auto_suggestions%ROWTYPE; v jsonb;
BEGIN
  IF NOT public._exchange_desk_staff(auth.uid()) THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT * INTO s FROM public.support_auto_suggestions WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR s.status <> 'nova' THEN RAISE EXCEPTION 'Sugestão não está aberta'; END IF;
  IF s.decision <> 'enviar_link' OR s.sale_id IS NULL OR s.link_type IS NULL THEN RETURN NULL; END IF;
  v := public.create_support_link(s.sale_id::text, s.link_type, 'agent', s.phone);
  RETURN v;
END $$;

CREATE OR REPLACE FUNCTION public.support_suggestion_mark_sent(p_id uuid, p_text text, p_link_id uuid DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT public._exchange_desk_staff(auth.uid()) THEN RAISE EXCEPTION 'forbidden'; END IF;
  UPDATE public.support_auto_suggestions SET status='enviada', sent_text=left(p_text,2000), sent_link_id=p_link_id, sent_by=auth.uid(), sent_at=now()
   WHERE id = p_id AND status = 'nova';
  IF NOT FOUND THEN RAISE EXCEPTION 'Sugestão não está aberta'; END IF;
END $$;

CREATE OR REPLACE FUNCTION public.support_suggestion_discard(p_id uuid, p_reason text, p_wrong boolean DEFAULT true) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT public._exchange_desk_staff(auth.uid()) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF coalesce(btrim(p_reason),'') = '' THEN RAISE EXCEPTION 'Informe o motivo'; END IF;
  UPDATE public.support_auto_suggestions SET status='descartada', discard_reason=left(p_reason,500), wrong_suggestion=coalesce(p_wrong,true),
    discarded_by=auth.uid(), discarded_at=now() WHERE id = p_id AND status = 'nova';
  IF NOT FOUND THEN RAISE EXCEPTION 'Sugestão não está aberta'; END IF;
END $$;

CREATE OR REPLACE FUNCTION public.support_auto_reply_settings_get() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r jsonb;
BEGIN
  IF NOT public._exchange_desk_staff(auth.uid()) THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT jsonb_build_object('mode', auto_reply_mode, 'instance_ids', to_jsonb(auto_reply_instance_ids), 'support_whatsapp_phone', support_whatsapp_phone,
    'central_public_enabled', central_public_enabled, 'is_admin', public.has_role(auth.uid(),'admin')) INTO r FROM public.support_settings LIMIT 1;
  RETURN r;
END $$;

CREATE OR REPLACE FUNCTION public.support_auto_reply_settings_update(p_mode text, p_instance_ids uuid[], p_support_phone text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'Só admin pode alterar'; END IF;
  IF p_mode NOT IN ('off','shadow','auto') THEN RAISE EXCEPTION 'Modo inválido'; END IF;
  UPDATE public.support_settings SET auto_reply_mode = p_mode, auto_reply_instance_ids = coalesce(p_instance_ids,'{}'),
    support_whatsapp_phone = NULLIF(regexp_replace(coalesce(p_support_phone,''),'\D','','g'),''), updated_at = now()
  WHERE auto_reply_mode IS DISTINCT FROM p_mode OR auto_reply_instance_ids IS DISTINCT FROM coalesce(p_instance_ids,'{}')
     OR support_whatsapp_phone IS DISTINCT FROM NULLIF(regexp_replace(coalesce(p_support_phone,''),'\D','','g'),'');
END $$;

REVOKE ALL ON FUNCTION public.support_suggestions_list(text,int,int), public.support_suggestion_prepare_link(uuid),
  public.support_suggestion_mark_sent(uuid,text,uuid), public.support_suggestion_discard(uuid,text,boolean),
  public.support_auto_reply_settings_get(), public.support_auto_reply_settings_update(text,uuid[],text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.support_suggestions_list(text,int,int), public.support_suggestion_prepare_link(uuid),
  public.support_suggestion_mark_sent(uuid,text,uuid), public.support_suggestion_discard(uuid,text,boolean),
  public.support_auto_reply_settings_get(), public.support_auto_reply_settings_update(text,uuid[],text) TO authenticated, service_role;