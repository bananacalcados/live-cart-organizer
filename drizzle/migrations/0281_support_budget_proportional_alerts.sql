ALTER TABLE public.support_ai_daily ADD COLUMN IF NOT EXISTS alert_80_at timestamptz, ADD COLUMN IF NOT EXISTS alert_100_at timestamptz;

CREATE OR REPLACE FUNCTION public.support_cost_reserve(p_suggestion uuid, p_phone text, p_number uuid, p_kind text, p_model text, p_tokens bigint)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$ DECLARE st public.support_settings%ROWTYPE; r public.support_ai_daily%ROWTYPE; d date:=(now() AT TIME ZONE 'America/Sao_Paulo')::date; v uuid; BEGIN
 SELECT * INTO st FROM public.support_settings LIMIT 1 FOR UPDATE;
 IF NOT st.ai_enabled THEN RETURN jsonb_build_object('allowed',false,'reason','ia_desligada'); END IF;
 -- Teto não pausa mais o dia: limpa pausa antiga por teto.
 IF st.ai_pause_reason='teto_diario_tokens' THEN UPDATE public.support_settings SET ai_pause_reason=NULL,ai_pause_until=NULL; st.ai_pause_reason:=NULL; END IF;
 IF st.ai_pause_reason IS NOT NULL AND (st.ai_pause_until IS NULL OR st.ai_pause_until>now()) THEN RETURN jsonb_build_object('allowed',false,'reason',st.ai_pause_reason); END IF;
 INSERT INTO public.support_ai_daily(day) VALUES(d) ON CONFLICT DO NOTHING;
 SELECT * INTO r FROM public.support_ai_daily WHERE day=d FOR UPDATE;
 IF p_tokens<=0 OR r.tokens+r.reserved+p_tokens>st.ai_daily_token_budget THEN
   UPDATE public.support_ai_daily SET budget_stops=budget_stops+1 WHERE day=d;
   RETURN jsonb_build_object('allowed',false,'reason','teto_diario','used',r.tokens,'reserved',r.reserved,'budget',st.ai_daily_token_budget,'requested',p_tokens);
 END IF;
 INSERT INTO public.support_ai_calls(suggestion_id,phone,whatsapp_number_id,kind,model,ok,reservation_tokens,settled,budget_day) VALUES(p_suggestion,p_phone,p_number,p_kind,p_model,false,p_tokens,false,d) RETURNING id INTO v;
 UPDATE public.support_ai_daily SET reserved=reserved+p_tokens,calls=calls+1 WHERE day=d;
 RETURN jsonb_build_object('allowed',true,'id',v); END $function$;

UPDATE public.support_settings SET ai_pause_reason=NULL, ai_pause_until=NULL WHERE ai_pause_reason='teto_diario_tokens';

CREATE OR REPLACE FUNCTION public.support_budget_alert_claim(p_level int)
 RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$ DECLARE d date:=(now() AT TIME ZONE 'America/Sao_Paulo')::date; ok boolean:=false; BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'forbidden'; END IF;
 IF p_level=100 THEN UPDATE public.support_ai_daily SET alert_100_at=now(), alert_80_at=coalesce(alert_80_at,now()) WHERE day=d AND alert_100_at IS NULL RETURNING true INTO ok;
 ELSIF p_level=80 THEN UPDATE public.support_ai_daily SET alert_80_at=now() WHERE day=d AND alert_80_at IS NULL RETURNING true INTO ok; END IF;
 RETURN coalesce(ok,false); END $function$;
REVOKE ALL ON FUNCTION public.support_budget_alert_claim(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.support_budget_alert_claim(int) TO service_role;

CREATE OR REPLACE FUNCTION public.support_ai_fallback(p_id uuid, p_error text)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$ DECLARE s public.support_auto_suggestions%ROWTYPE; BEGIN SELECT * INTO s FROM public.support_auto_suggestions WHERE id=p_id FOR UPDATE; IF NOT FOUND OR s.status<>'processando' THEN RETURN NULL; END IF;
 IF p_error ILIKE '%teto diário da IA%' THEN
   UPDATE public.support_auto_suggestions SET ai_status='falhou_reserva',ai_error=left(p_error,500),status='nova',decision='fila',reason='teto diário da IA',suggested_text=NULL,handoff_summary='Teto diário da IA atingido: atender manualmente; nenhuma mensagem foi enviada.',would_route_support=true,auto_send_after=NULL,link_type=NULL WHERE id=p_id;
   PERFORM public._support_move_to_support_line(s.phone, s.whatsapp_number_id, NULL);
   RETURN p_id;
 END IF;
 UPDATE public.support_auto_suggestions SET ai_status='falhou_reserva',ai_error=left(p_error,500),status=CASE WHEN public.support_cost_keywords(incoming_text) THEN 'nova' ELSE 'ignorada' END,decision='fila',reason='reserva_palavras:'||left(p_error,200),suggested_text=NULL,handoff_summary='Reserva sem IA: revisar o pedido de suporte da cliente; nenhum envio ou movimento realizado.',would_route_support=public.support_cost_keywords(incoming_text),auto_send_after=NULL,link_type=NULL WHERE id=p_id; RETURN p_id; END $function$;

CREATE OR REPLACE FUNCTION public.support_guard_status()
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE s record; tri record; paused jsonb; used bigint;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' AND NOT public.is_team_member(auth.uid()) THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT * INTO s FROM public.support_settings WHERE id=true;
  WITH x AS (SELECT suggestion_id, bool_or(ok) any_ok FROM public.support_ai_attempts
             WHERE kind='triagem' AND created_at>now()-interval '15 minutes' AND created_at<now()-interval '1 minute' GROUP BY suggestion_id)
  SELECT count(*)::int tot, count(*) FILTER (WHERE NOT any_ok)::int bad INTO tri FROM x;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',p.whatsapp_number_id,'name',coalesce(w.label,w.phone_display,p.whatsapp_number_id::text),
      'provider',w.provider,'until',p.paused_until,'reason',p.reason) ORDER BY p.paused_until),'[]'::jsonb) INTO paused
    FROM public.support_channel_pauses p LEFT JOIN public.whatsapp_numbers w ON w.id=p.whatsapp_number_id WHERE p.paused_until>now();
  SELECT coalesce(tokens,0) INTO used FROM public.support_ai_daily WHERE day=(now() AT TIME ZONE 'America/Sao_Paulo')::date;
  RETURN jsonb_build_object('mode',s.auto_reply_mode,'shadow_auto',s.shadow_auto,'shadow_reason',s.shadow_reason,'shadow_at',s.shadow_at,
    'paused',paused,'triage_total',tri.tot,'triage_failed',tri.bad,
    'alert_configured',(nullif(s.alert_phone,'') IS NOT NULL AND s.alert_whatsapp_number_id IS NOT NULL),
    'alert_state',s.alert_state,'alert_last_sent_at',s.alert_last_sent_at,
    'budget_used',coalesce(used,0),'budget_limit',s.ai_daily_token_budget)
    || CASE WHEN auth.role()='service_role' THEN jsonb_build_object('alert_phone',s.alert_phone,'alert_whatsapp_number_id',s.alert_whatsapp_number_id) ELSE '{}'::jsonb END;
END $function$;