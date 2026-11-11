-- Fase 4b: triagem + agente de suporte por IA (modo sombra). Aditivo.
ALTER TABLE public.support_settings
  ADD COLUMN IF NOT EXISTS ai_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS ai_triage_model text NOT NULL DEFAULT 'openai/gpt-6-luna',
  ADD COLUMN IF NOT EXISTS ai_agent_model text NOT NULL DEFAULT 'openai/gpt-6-astra',
  ADD COLUMN IF NOT EXISTS ai_max_calls_per_conversation_day integer NOT NULL DEFAULT 8,
  ADD COLUMN IF NOT EXISTS ai_timeout_ms integer NOT NULL DEFAULT 30000;
UPDATE public.support_settings SET max_offer_attempts = 1 WHERE max_offer_attempts IS DISTINCT FROM 1;

ALTER TABLE public.support_auto_suggestions
  ADD COLUMN IF NOT EXISTS ai_status text,
  ADD COLUMN IF NOT EXISTS ai_error text,
  ADD COLUMN IF NOT EXISTS triage jsonb,
  ADD COLUMN IF NOT EXISTS triage_category text,
  ADD COLUMN IF NOT EXISTS triage_confidence numeric,
  ADD COLUMN IF NOT EXISTS agent_actions jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS exchange_offered boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS handoff_summary text,
  ADD COLUMN IF NOT EXISTS script_version integer;
ALTER TABLE public.support_auto_suggestions DROP CONSTRAINT IF EXISTS support_auto_suggestions_decision_check;
ALTER TABLE public.support_auto_suggestions ADD CONSTRAINT support_auto_suggestions_decision_check
  CHECK (decision = ANY (ARRAY['enviar_link','presencial','instagram_whatsapp','fila','conversa']));
ALTER TABLE public.support_auto_suggestions DROP CONSTRAINT IF EXISTS support_auto_suggestions_status_check;
ALTER TABLE public.support_auto_suggestions ADD CONSTRAINT support_auto_suggestions_status_check
  CHECK (status = ANY (ARRAY['nova','enviada','descartada','substituida','ignorada','processando']));
CREATE INDEX IF NOT EXISTS idx_support_sugg_conv ON public.support_auto_suggestions (phone, whatsapp_number_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.support_agent_scripts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version integer NOT NULL UNIQUE,
  body text NOT NULL,
  note text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.support_agent_scripts TO authenticated;
GRANT ALL ON public.support_agent_scripts TO service_role;
ALTER TABLE public.support_agent_scripts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "equipe de trocas le roteiro" ON public.support_agent_scripts FOR SELECT TO authenticated
  USING (public._exchange_desk_staff(auth.uid()));

CREATE TABLE IF NOT EXISTS public.support_ai_calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  suggestion_id uuid,
  phone text NOT NULL,
  whatsapp_number_id uuid,
  kind text NOT NULL CHECK (kind IN ('triagem','agente')),
  model text NOT NULL,
  ok boolean NOT NULL,
  error text,
  duration_ms integer,
  input_tokens integer,
  output_tokens integer,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_support_ai_calls_conv ON public.support_ai_calls (phone, whatsapp_number_id, created_at DESC);
GRANT SELECT ON public.support_ai_calls TO authenticated;
GRANT ALL ON public.support_ai_calls TO service_role;
ALTER TABLE public.support_ai_calls ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin le chamadas de ia" ON public.support_ai_calls FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

INSERT INTO public.support_agent_scripts(version, body, note) VALUES (1,
$s$Você é a atendente de pós-venda da Banana Calçados no WhatsApp.
TOM: frases curtas e simpáticas, no máximo 2 linhas, 1 emoji no máximo. Chame a cliente pelo primeiro nome. Sempre termine com uma pergunta, exceto quando for passar para uma pessoa da equipe.

REGRAS:
1. Motivo de tamanho, numeração ou modelo (mesmo que ela diga "devolver"): ofereça a TROCA primeiro, de forma positiva, perguntando a numeração. Ex.: "Maravilha, {nome}! A gente troca pra você. Qual numeração você quer?". Antes de oferecer, chame registrar_oferta_troca. Ofereça UMA vez só. Se ela insistir em devolver, siga com a devolução sem argumentar.
2. Arrependimento sem motivo de tamanho: pergunte o motivo uma vez. Se for tamanho, ofereça a troca; se não, siga com a devolução.
3. Passe para uma pessoa (escalar_humano, com resumo) quando: defeito ou avaria, cliente irritada, ameaça (Procon, Reclame Aqui, advogado), pedido para falar com uma pessoa, vários pedidos, pedido fora do prazo, entrega sem confirmação, ou assunto que você não entendeu.
4. Compra feita na loja física: a troca é feita na loja, sem link.
5. Nunca negue. Nunca prometa valor ou prazo de reembolso. Nunca invente informação de pedido, prazo ou estoque: use só o que as ferramentas devolverem.
6. Quando a troca ou devolução estiver decidida e o pedido for elegível: chame preparar_link e diga que vai mandar o link para registrar (troca: escolher a numeração; devolução: informar o motivo) e que o código de postagem vem em seguida. Escreva {{link}} onde o link deve aparecer. Nunca diga que o código de postagem já foi gerado.
7. Para dizer se tem numeração disponível, use consultar_numeracoes.$s$, 'Roteiro inicial aprovado pelo dono')
ON CONFLICT (version) DO NOTHING;

CREATE OR REPLACE FUNCTION public.support_agent_script_get()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public._exchange_desk_staff(auth.uid()) THEN RAISE EXCEPTION 'forbidden'; END IF;
  RETURN jsonb_build_object(
    'current', (SELECT to_jsonb(s) FROM public.support_agent_scripts s ORDER BY version DESC LIMIT 1),
    'history', coalesce((SELECT jsonb_agg(jsonb_build_object('version',version,'note',note,'created_at',created_at,'body',body) ORDER BY version DESC)
                FROM (SELECT * FROM public.support_agent_scripts ORDER BY version DESC LIMIT 30) h), '[]'::jsonb));
END $$;

CREATE OR REPLACE FUNCTION public.support_agent_script_save(p_body text, p_note text DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v int;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'Só admin edita o roteiro'; END IF;
  IF length(btrim(coalesce(p_body,''))) < 20 THEN RAISE EXCEPTION 'Roteiro muito curto'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('support_agent_script'));
  SELECT coalesce(max(version),0)+1 INTO v FROM public.support_agent_scripts;
  INSERT INTO public.support_agent_scripts(version, body, note, created_by) VALUES (v, left(p_body, 20000), left(p_note,300), auth.uid());
  RETURN v;
END $$;

CREATE OR REPLACE FUNCTION public.support_ai_accuracy()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public._exchange_desk_staff(auth.uid()) THEN RAISE EXCEPTION 'forbidden'; END IF;
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('tipo', t, 'acertos', ok, 'erros', er, 'abertas', ab)) FROM (
    SELECT coalesce(triage_category, intent) t,
      count(*) FILTER (WHERE status='enviada') ok,
      count(*) FILTER (WHERE status='descartada' AND wrong_suggestion) er,
      count(*) FILTER (WHERE status='nova') ab
    FROM public.support_auto_suggestions WHERE created_at > now() - interval '90 days' AND status <> 'substituida'
    GROUP BY 1) x), '[]'::jsonb);
END $$;

-- Enfileira a IA: mesmas travas da Fase 4; a palavra-chave vira só reserva.
CREATE OR REPLACE FUNCTION public.support_ai_enqueue(p_message_row_id uuid, p_phone text, p_number_id uuid, p_channel text, p_text text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE st public.support_settings%ROWTYPE; v_id uuid; v_ongoing boolean;
BEGIN
  SELECT * INTO st FROM public.support_settings LIMIT 1;
  IF st.auto_reply_mode IS NULL OR st.auto_reply_mode = 'off' THEN RETURN NULL; END IF;
  IF p_number_id IS NULL OR NOT (p_number_id = ANY(st.auto_reply_instance_ids)) THEN RETURN NULL; END IF;
  IF NOT coalesce(st.ai_enabled, false) THEN
    RETURN public.support_auto_evaluate(p_message_row_id, p_phone, p_number_id, p_channel, p_text);
  END IF;
  v_ongoing := EXISTS (SELECT 1 FROM public.support_auto_suggestions s WHERE s.phone = p_phone AND s.whatsapp_number_id = p_number_id
     AND s.created_at > now() - interval '24 hours' AND s.status IN ('nova','enviada','processando'));
  IF NOT v_ongoing AND coalesce(p_text,'') !~* '(tro[ck]|devo|reembol|estorn|volta|arrepend|n[uú]mer|serv|coube|ficou|tamanho|cancel|defeit|rasg|desc?ol|quebr|pequen|grand|apert|larg|pedido|rastre|chego|cheg|cad[eê]|entreg|atras|procon|reclame|dinheiro)' THEN
    RETURN NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM public.whatsapp_messages m WHERE m.phone = p_phone AND m.whatsapp_number_id = p_number_id
             AND m.direction = 'outgoing' AND m.sender_user_id IS NOT NULL AND m.created_at > now() - interval '2 hours') THEN RETURN NULL; END IF;

  UPDATE public.support_auto_suggestions SET status = 'substituida'
   WHERE phone = p_phone AND whatsapp_number_id = p_number_id AND status IN ('nova','processando');
  INSERT INTO public.support_auto_suggestions(message_row_id, whatsapp_number_id, channel, phone, incoming_text, intent, decision, reason,
     mode_at_creation, ai_status, status)
  VALUES (p_message_row_id, p_number_id, coalesce(p_channel,'whatsapp'), p_phone, left(p_text,1000),
     coalesce(public.support_classify_intent(p_text),'indefinido'), 'fila', 'aguardando_ia', st.auto_reply_mode, 'pendente', 'processando')
  ON CONFLICT (message_row_id) DO NOTHING RETURNING id INTO v_id;
  IF v_id IS NULL THEN RETURN NULL; END IF;

  PERFORM net.http_post(
    url := 'https://tqxhcyuxgqbzqwoidpie.supabase.co/functions/v1/support-ai-agent',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',(SELECT value FROM public.internal_function_secrets WHERE key='cron_secret')),
    body := jsonb_build_object('suggestion_id', v_id), timeout_milliseconds := 60000);
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.support_ai_enqueue(uuid,text,uuid,text,text) FROM PUBLIC, anon, authenticated;

-- Reserva por palavra-chave quando a IA falha: recalcula a sugestão pela regra da Fase 4.
CREATE OR REPLACE FUNCTION public.support_ai_fallback(p_id uuid, p_error text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s public.support_auto_suggestions%ROWTYPE; v_new uuid;
BEGIN
  SELECT * INTO s FROM public.support_auto_suggestions WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR s.status <> 'processando' THEN RETURN NULL; END IF;
  DELETE FROM public.support_auto_suggestions WHERE id = p_id;
  v_new := public.support_auto_evaluate(s.message_row_id, s.phone, s.whatsapp_number_id, s.channel, s.incoming_text);
  IF v_new IS NOT NULL THEN
    UPDATE public.support_auto_suggestions SET ai_status = 'falhou_reserva', ai_error = left(p_error,500) WHERE id = v_new;
  END IF;
  RETURN v_new;
END $$;
REVOKE ALL ON FUNCTION public.support_ai_fallback(uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.support_ai_fallback(uuid,text) TO service_role;
REVOKE ALL ON FUNCTION public.support_auto_evaluate(uuid,text,uuid,text,text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.support_auto_detect_trigger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  BEGIN
    PERFORM public.support_ai_enqueue(NEW.id, NEW.phone, NEW.whatsapp_number_id, NEW.channel, NEW.message);
  EXCEPTION WHEN others THEN
    RAISE WARNING 'support_auto_detect: %', SQLERRM; -- nunca bloqueia a mensagem
  END;
  RETURN NULL;
END $$;

-- Gatilho: filtro de assunto agora fica dentro da função (para acompanhar respostas como "38").
DROP TRIGGER IF EXISTS trg_support_auto_detect ON public.whatsapp_messages;
CREATE TRIGGER trg_support_auto_detect AFTER INSERT ON public.whatsapp_messages FOR EACH ROW
  WHEN (NEW.direction::text = 'incoming' AND NEW.is_group IS NOT TRUE AND NEW.message IS NOT NULL)
  EXECUTE FUNCTION public.support_auto_detect_trigger();

REVOKE ALL ON FUNCTION public.support_agent_script_get() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.support_agent_script_save(text,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.support_ai_accuracy() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.support_agent_script_get() TO authenticated;
GRANT EXECUTE ON FUNCTION public.support_agent_script_save(text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.support_ai_accuracy() TO authenticated;

-- Configurações: incluir campos de IA no get/update existente
CREATE OR REPLACE FUNCTION public.support_ai_settings_update(p_enabled boolean, p_triage_model text, p_agent_model text, p_max_calls integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'Só admin altera'; END IF;
  IF p_triage_model !~ '^[a-z]+/[a-z0-9.\-]+$' OR p_agent_model !~ '^[a-z]+/[a-z0-9.\-]+$' THEN RAISE EXCEPTION 'Modelo inválido'; END IF;
  UPDATE public.support_settings SET ai_enabled = p_enabled, ai_triage_model = p_triage_model, ai_agent_model = p_agent_model,
    ai_max_calls_per_conversation_day = greatest(1, least(coalesce(p_max_calls,8), 50)), updated_at = now();
END $$;
REVOKE ALL ON FUNCTION public.support_ai_settings_update(boolean,text,text,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.support_ai_settings_update(boolean,text,text,integer) TO authenticated;