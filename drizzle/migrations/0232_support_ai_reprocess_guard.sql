CREATE OR REPLACE FUNCTION public.support_cost_claim_direct(p_id uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE s public.support_auto_suggestions%ROWTYPE; d date:=(now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  SELECT * INTO s FROM public.support_auto_suggestions WHERE id=p_id FOR UPDATE;
  IF NOT FOUND OR s.status<>'processando' OR s.cost_claimed_at IS NOT NULL OR s.cost_due_at>now() THEN RETURN false; END IF;
  IF NOT s.cost_prefilter_passed AND (public.support_cost_human(s.phone,s.channel) OR (NOT public.support_cost_keywords(s.incoming_text) AND NOT public.support_cost_recent_order(s.phone))) THEN
    UPDATE public.support_auto_suggestions SET status='ignorada',reason='pre_filtro_ao_processar' WHERE id=p_id;
    RETURN false;
  END IF;
  UPDATE public.support_auto_suggestions SET cost_claimed_at=now(),cost_prefilter_passed=true WHERE id=p_id;
  INSERT INTO public.support_ai_daily(day,prefiltered) VALUES(d,1) ON CONFLICT(day) DO UPDATE SET prefiltered=support_ai_daily.prefiltered+1;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.support_cost_claim_direct(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.support_cost_claim_direct(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.support_ai_reprocess(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE s public.support_auto_suggestions%ROWTYPE; st public.support_settings%ROWTYPE;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT * INTO st FROM public.support_settings WHERE id=true;
  SELECT * INTO s FROM public.support_auto_suggestions WHERE id=p_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('reprocess',false,'reason','nao_encontrada'); END IF;
  IF st.auto_reply_mode<>'auto' OR s.mode_at_creation<>'auto' OR NOT(s.whatsapp_number_id=ANY(st.auto_reply_instance_ids)) THEN RETURN jsonb_build_object('reprocess',false,'reason','modo_ou_instancia'); END IF;
  IF EXISTS(SELECT 1 FROM public.whatsapp_messages m WHERE m.phone=s.phone AND m.whatsapp_number_id=s.whatsapp_number_id AND m.direction='outgoing' AND m.sender_user_id IS NOT NULL AND m.created_at>s.created_at) THEN
    UPDATE public.support_auto_suggestions SET status='ignorada',reason='humano_respondeu_antes_do_reprocessamento' WHERE id=s.id;
    RETURN jsonb_build_object('reprocess',false,'reason','humano_respondeu');
  END IF;
  IF EXISTS(SELECT 1 FROM public.support_outbox o WHERE o.requested_by='assistant_auto' AND o.phone=s.phone AND o.whatsapp_number_id=s.whatsapp_number_id AND (o.status='pending' OR o.status='sent' AND o.sent_at>=now()-interval '24 hours')) THEN
    RETURN jsonb_build_object('reprocess',false,'reason','automatico_24h_ou_fila');
  END IF;
  UPDATE public.support_auto_suggestions SET status='processando',ai_status='pendente',ai_error=NULL,reason='reprocessamento_autorizado',suggested_text=NULL,handoff_summary=NULL,auto_send_after=NULL,cost_claimed_at=NULL,cost_prefilter_passed=true,cost_due_at=now() WHERE id=s.id;
  RETURN jsonb_build_object('reprocess',true,'id',s.id);
END $$;
REVOKE ALL ON FUNCTION public.support_ai_reprocess(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.support_ai_reprocess(uuid) TO service_role;