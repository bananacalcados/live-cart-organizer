
-- 1) Provider registrado em cada chamada
ALTER TABLE public.support_ai_calls ADD COLUMN IF NOT EXISTS provider text;

-- 2) Falhas totais (todos os provedores) — base da pausa de 10 min
CREATE TABLE public.support_ai_outages(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  suggestion_id uuid,
  reason text,
  paused_until timestamptz
);
REVOKE ALL ON public.support_ai_outages FROM anon, authenticated;
GRANT ALL ON public.support_ai_outages TO service_role;
ALTER TABLE public.support_ai_outages ENABLE ROW LEVEL SECURITY;
CREATE INDEX support_ai_outages_created_idx ON public.support_ai_outages(created_at);

-- 3) Watchdog antigo não pausa mais sem prazo (a pausa geral agora só vem de support_ai_outage_record)
CREATE OR REPLACE FUNCTION public.support_ai_failure_watchdog()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  -- Desativado: pausa geral só quando todos os provedores falham 3x em 15 min, sempre com 10 min de prazo.
  RETURN NEW;
END $function$;

-- 4) Pausa SEMPRE com prazo de no máximo 10 min
CREATE OR REPLACE FUNCTION public.support_cost_pause(p_reason text, p_until timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO 'public'
AS $function$
 UPDATE public.support_settings
    SET ai_pause_reason = left(p_reason,400),
        ai_pause_until = CASE WHEN p_reason IS NULL THEN NULL
                              ELSE least(coalesce(p_until, now()+interval '10 minutes'), now()+interval '10 minutes') END
  WHERE true
$function$;

-- limpa qualquer pausa antiga sem prazo e proíbe no banco
UPDATE public.support_settings SET ai_pause_reason=NULL WHERE ai_pause_reason IS NOT NULL AND ai_pause_until IS NULL;
ALTER TABLE public.support_settings ADD CONSTRAINT support_settings_ai_pause_has_deadline
  CHECK (ai_pause_reason IS NULL OR ai_pause_until IS NOT NULL);

-- 5) Reserva: só pausa vigente bloqueia; grava provedor
CREATE OR REPLACE FUNCTION public.support_cost_reserve(p_suggestion uuid, p_phone text, p_number uuid, p_kind text, p_model text, p_tokens bigint)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$ DECLARE st public.support_settings%ROWTYPE; r public.support_ai_daily%ROWTYPE; d date:=(now() AT TIME ZONE 'America/Sao_Paulo')::date; v uuid; BEGIN
 SELECT * INTO st FROM public.support_settings LIMIT 1 FOR UPDATE;
 IF NOT st.ai_enabled THEN RETURN jsonb_build_object('allowed',false,'reason','ia_desligada'); END IF;
 IF st.ai_pause_reason='teto_diario_tokens' THEN UPDATE public.support_settings SET ai_pause_reason=NULL,ai_pause_until=NULL; st.ai_pause_reason:=NULL; END IF;
 IF st.ai_pause_reason IS NOT NULL AND st.ai_pause_until>now() THEN RETURN jsonb_build_object('allowed',false,'reason',st.ai_pause_reason,'until',st.ai_pause_until); END IF;
 INSERT INTO public.support_ai_daily(day) VALUES(d) ON CONFLICT DO NOTHING;
 SELECT * INTO r FROM public.support_ai_daily WHERE day=d FOR UPDATE;
 IF p_tokens<=0 OR r.tokens+r.reserved+p_tokens>st.ai_daily_token_budget THEN
   UPDATE public.support_ai_daily SET budget_stops=budget_stops+1 WHERE day=d;
   RETURN jsonb_build_object('allowed',false,'reason','teto_diario','used',r.tokens,'reserved',r.reserved,'budget',st.ai_daily_token_budget,'requested',p_tokens);
 END IF;
 INSERT INTO public.support_ai_calls(suggestion_id,phone,whatsapp_number_id,kind,model,provider,ok,reservation_tokens,settled,budget_day)
 VALUES(p_suggestion,p_phone,p_number,p_kind,p_model,CASE WHEN p_model ILIKE 'claude%' OR p_model ILIKE 'anthropic/%' THEN 'anthropic' ELSE 'lovable_ai' END,false,p_tokens,false,d) RETURNING id INTO v;
 UPDATE public.support_ai_daily SET reserved=reserved+p_tokens,calls=calls+1 WHERE day=d;
 RETURN jsonb_build_object('allowed',true,'id',v); END $function$;

-- 6) Falha total registrada; 3 em 15 min => pausa de 10 min (uma vez)
CREATE OR REPLACE FUNCTION public.support_ai_outage_record(p_suggestion uuid, p_reason text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$ DECLARE st public.support_settings%ROWTYPE; since timestamptz; n int; v uuid; u timestamptz; BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' AND current_user NOT IN ('postgres','supabase_admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
 SELECT * INTO st FROM public.support_settings LIMIT 1 FOR UPDATE;
 INSERT INTO public.support_ai_outages(suggestion_id,reason) VALUES(p_suggestion,left(p_reason,400)) RETURNING id INTO v;
 IF st.ai_pause_reason IS NOT NULL AND st.ai_pause_until>now() THEN
   RETURN jsonb_build_object('paused',true,'new',false,'until',st.ai_pause_until);
 END IF;
 SELECT greatest(now()-interval '15 minutes', coalesce(max(paused_until),'epoch'::timestamptz)) INTO since FROM public.support_ai_outages;
 SELECT count(*) INTO n FROM public.support_ai_outages WHERE created_at>since;
 IF n<3 THEN RETURN jsonb_build_object('paused',false,'failures',n); END IF;
 u := now()+interval '10 minutes';
 UPDATE public.support_settings SET ai_pause_reason=left('ia_pausada_10min: todos os provedores falharam 3x em 15 min | '||coalesce(p_reason,''),400), ai_pause_until=u;
 UPDATE public.support_ai_outages SET paused_until=u WHERE id=v;
 RETURN jsonb_build_object('paused',true,'new',true,'until',u,'failures',n);
END $function$;
REVOKE ALL ON FUNCTION public.support_ai_outage_record(uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.support_ai_outage_record(uuid,text) TO service_role;

-- 7) Sem IA disponível => Em suporte (igual ao teto)
CREATE OR REPLACE FUNCTION public.support_ai_fallback(p_id uuid, p_error text)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$ DECLARE s public.support_auto_suggestions%ROWTYPE; BEGIN SELECT * INTO s FROM public.support_auto_suggestions WHERE id=p_id FOR UPDATE; IF NOT FOUND OR s.status<>'processando' THEN RETURN NULL; END IF;
 IF p_error ILIKE '%teto diário da IA%' THEN
   UPDATE public.support_auto_suggestions SET ai_status='falhou_reserva',ai_error=left(p_error,500),status='nova',decision='fila',reason='teto diário da IA',suggested_text=NULL,handoff_summary='Teto diário da IA atingido: atender manualmente; nenhuma mensagem foi enviada.',would_route_support=true,auto_send_after=NULL,link_type=NULL WHERE id=p_id;
   PERFORM public._support_move_to_support_line(s.phone, s.whatsapp_number_id, NULL);
   RETURN p_id;
 END IF;
 IF p_error ILIKE 'IA indisponível%' THEN
   UPDATE public.support_auto_suggestions SET ai_status='falhou_ia',ai_error=left(p_error,500),status='nova',decision='fila',reason='IA indisponível',suggested_text=NULL,handoff_summary='IA do suporte indisponível (provedores falharam): atender manualmente; nenhuma mensagem foi enviada.',would_route_support=true,auto_send_after=NULL,link_type=NULL WHERE id=p_id;
   PERFORM public._support_move_to_support_line(s.phone, s.whatsapp_number_id, NULL);
   RETURN p_id;
 END IF;
 UPDATE public.support_auto_suggestions SET ai_status='falhou_reserva',ai_error=left(p_error,500),status=CASE WHEN public.support_cost_keywords(incoming_text) THEN 'nova' ELSE 'ignorada' END,decision='fila',reason='reserva_palavras:'||left(p_error,200),suggested_text=NULL,handoff_summary='Reserva sem IA: revisar o pedido de suporte da cliente; nenhum envio ou movimento realizado.',would_route_support=public.support_cost_keywords(incoming_text),auto_send_after=NULL,link_type=NULL WHERE id=p_id; RETURN p_id; END $function$;

-- 8) Painel só mostra pausa vigente
CREATE OR REPLACE FUNCTION public.support_cost_dashboard()
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$ DECLARE d date:=(now() AT TIME ZONE 'America/Sao_Paulo')::date; BEGIN IF NOT public._exchange_desk_staff(auth.uid()) THEN RAISE EXCEPTION 'forbidden'; END IF; RETURN jsonb_build_object('budget',(SELECT ai_daily_token_budget FROM public.support_settings LIMIT 1),'pause',(SELECT CASE WHEN ai_pause_until>now() THEN ai_pause_reason END FROM public.support_settings LIMIT 1),'days',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY day DESC) FROM public.support_ai_daily x WHERE day>=d-6),'[]'::jsonb),'today',d); END $function$;
