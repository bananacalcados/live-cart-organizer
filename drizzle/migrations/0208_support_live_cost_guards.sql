ALTER TABLE public.support_settings ADD COLUMN ai_daily_token_budget bigint NOT NULL DEFAULT 2000000 CHECK(ai_daily_token_budget>0), ADD COLUMN ai_pause_reason text, ADD COLUMN ai_pause_until timestamptz, ADD COLUMN ai_worker_lease uuid, ADD COLUMN ai_worker_until timestamptz;
ALTER TABLE public.support_auto_suggestions ADD COLUMN cost_due_at timestamptz, ADD COLUMN cost_claimed_at timestamptz, ADD COLUMN cost_key text, ADD COLUMN cost_prefilter_passed boolean NOT NULL DEFAULT false;
CREATE INDEX support_cost_due ON public.support_auto_suggestions(cost_due_at,id) WHERE status='processando' AND cost_due_at IS NOT NULL;
CREATE INDEX support_cost_key ON public.support_auto_suggestions(cost_key,created_at DESC);
ALTER TABLE public.support_ai_calls ADD COLUMN reservation_tokens bigint NOT NULL DEFAULT 0, ADD COLUMN settled boolean NOT NULL DEFAULT true, ADD COLUMN budget_day date, ADD COLUMN gateway_run_id text;
CREATE TABLE public.support_ai_daily(day date PRIMARY KEY, tokens bigint NOT NULL DEFAULT 0, reserved bigint NOT NULL DEFAULT 0, calls integer NOT NULL DEFAULT 0, prefiltered integer NOT NULL DEFAULT 0, suggestions integer NOT NULL DEFAULT 0, decisions jsonb NOT NULL DEFAULT '{}'::jsonb, budget_stops integer NOT NULL DEFAULT 0);
GRANT ALL ON public.support_ai_daily TO service_role;
ALTER TABLE public.support_ai_daily ENABLE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION public.support_cost_keywords(p text) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=public AS $$ SELECT public.support_normalize_text(p) ~ '\m(troca\w*|devolver|devolucao|reembolso\w*|estorno\w*|rastreio|rastrear|cade|entrega\w*|defeito\w*|cancelar|codigo|postagem|numeracao)\M|nao chegou|ficou (pequeno|grande)|nao (me )?serviu' $$;
REVOKE ALL ON FUNCTION public.support_cost_keywords(text) FROM PUBLIC,anon,authenticated; GRANT EXECUTE ON FUNCTION public.support_cost_keywords(text) TO service_role;
CREATE OR REPLACE FUNCTION public.support_cost_recent_order(p_phone text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$ SELECT length(regexp_replace(p_phone,'\D','','g'))>=8 AND EXISTS(SELECT 1 FROM public.pos_sales WHERE phone_suffix8=right(regexp_replace(p_phone,'\D','','g'),8) AND created_at>=now()-interval '60 days') $$;
REVOKE ALL ON FUNCTION public.support_cost_recent_order(text) FROM PUBLIC,anon,authenticated; GRANT EXECUTE ON FUNCTION public.support_cost_recent_order(text) TO service_role;
CREATE OR REPLACE FUNCTION public.support_cost_human(p_phone text,p_channel text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$ SELECT EXISTS(SELECT 1 FROM public.whatsapp_conversations c CROSS JOIN LATERAL(SELECT 1 FROM public.whatsapp_messages m WHERE m.phone=c.phone AND m.whatsapp_number_id IS NOT DISTINCT FROM c.whatsapp_number_id AND m.direction='outgoing' AND m.sender_user_id IS NOT NULL AND m.created_at>=now()-interval '2 hours' LIMIT 1) h WHERE c.channel=coalesce(p_channel,'whatsapp') AND NOT c.is_group AND (c.phone=p_phone OR (p_channel='whatsapp' AND c.phone LIKE '%'||right(regexp_replace(p_phone,'\D','','g'),8))) LIMIT 1) $$;
REVOKE ALL ON FUNCTION public.support_cost_human(text,text) FROM PUBLIC,anon,authenticated; GRANT EXECUTE ON FUNCTION public.support_cost_human(text,text) TO service_role;
CREATE OR REPLACE FUNCTION public.support_ai_enqueue(p_message_row_id uuid,p_phone text,p_number_id uuid,p_channel text,p_text text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE st public.support_settings%ROWTYPE; v_id uuid; k text; old public.support_auto_suggestions%ROWTYPE;
BEGIN
 SELECT * INTO st FROM public.support_settings LIMIT 1;
 IF st.auto_reply_mode<>'shadow' OR p_number_id IS NULL OR NOT(p_number_id=ANY(st.auto_reply_instance_ids)) THEN RETURN NULL; END IF;
 IF coalesce(p_text,'') !~ '[[:alnum:]]' OR public.support_cost_human(p_phone,p_channel) THEN RETURN NULL; END IF;
 k:=CASE WHEN coalesce(p_channel,'whatsapp')='whatsapp' THEN 'wa:'||right(regexp_replace(p_phone,'\D','','g'),8) ELSE 'ig:'||p_phone END;
 PERFORM pg_advisory_xact_lock(hashtextextended('support_cost:'||k,0));
 SELECT * INTO old FROM public.support_auto_suggestions WHERE cost_key=k AND status='processando' AND cost_claimed_at IS NULL ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
 IF FOUND THEN
 UPDATE public.support_auto_suggestions SET incoming_text=left(coalesce(incoming_text,'')||E'\n'||p_text,4000),message_row_id=p_message_row_id,phone=p_phone,whatsapp_number_id=p_number_id,cost_due_at=now()+interval '2 minutes' WHERE id=old.id; RETURN old.id;
 END IF;
 IF NOT public.support_cost_keywords(p_text) AND NOT public.support_cost_recent_order(p_phone) THEN RETURN NULL; END IF;
 INSERT INTO public.support_auto_suggestions(message_row_id,whatsapp_number_id,channel,phone,incoming_text,intent,decision,reason,mode_at_creation,ai_status,status,cost_key,cost_due_at)
 VALUES(p_message_row_id,p_number_id,coalesce(p_channel,'whatsapp'),p_phone,left(p_text,4000),coalesce(public.support_classify_intent(p_text),'indefinido'),'fila','aguardando_silencio','shadow','pendente','processando',k,now()+interval '2 minutes') ON CONFLICT(message_row_id) DO NOTHING RETURNING id INTO v_id;
 RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.support_ai_enqueue(uuid,text,uuid,text,text) FROM PUBLIC,anon,authenticated; GRANT EXECUTE ON FUNCTION public.support_ai_enqueue(uuid,text,uuid,text,text) TO service_role;
CREATE OR REPLACE FUNCTION public.support_auto_detect_trigger() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ BEGIN BEGIN IF coalesce(NEW.media_type,'') !~* '^(sticker|reaction|reacao|figurinha)$' THEN PERFORM public.support_ai_enqueue(NEW.id,NEW.phone,NEW.whatsapp_number_id,NEW.channel,NEW.message); END IF; EXCEPTION WHEN others THEN RAISE WARNING 'support_auto_detect: %',SQLERRM; END; RETURN NULL; END $$;
CREATE OR REPLACE FUNCTION public.support_cost_worker_claim(p_lease uuid) RETURNS SETOF public.support_auto_suggestions LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE st public.support_settings%ROWTYPE; s public.support_auto_suggestions%ROWTYPE; d date:=(now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
 SELECT * INTO st FROM public.support_settings LIMIT 1 FOR UPDATE;
 IF st.auto_reply_mode<>'shadow' OR st.ai_worker_until>now() THEN RETURN; END IF;
 UPDATE public.support_settings SET ai_worker_lease=p_lease,ai_worker_until=now()+interval '5 minutes';
 FOR s IN SELECT * FROM public.support_auto_suggestions WHERE status='processando' AND cost_due_at<=now() AND cost_claimed_at IS NULL ORDER BY cost_due_at,id LIMIT 2 FOR UPDATE SKIP LOCKED LOOP
 IF NOT(s.whatsapp_number_id=ANY(st.auto_reply_instance_ids)) OR public.support_cost_human(s.phone,s.channel) OR (NOT public.support_cost_keywords(s.incoming_text) AND NOT public.support_cost_recent_order(s.phone)) THEN
 UPDATE public.support_auto_suggestions SET status='ignorada',reason='pre_filtro_ao_processar' WHERE id=s.id; CONTINUE;
 END IF;
 UPDATE public.support_auto_suggestions SET cost_claimed_at=now(),cost_prefilter_passed=true,reason='aguardando_ia' WHERE id=s.id;
 INSERT INTO public.support_ai_daily(day,prefiltered) VALUES(d,1) ON CONFLICT(day) DO UPDATE SET prefiltered=support_ai_daily.prefiltered+1;
 RETURN QUERY SELECT * FROM public.support_auto_suggestions WHERE id=s.id;
 END LOOP;
END $$;
CREATE OR REPLACE FUNCTION public.support_cost_worker_finish(p_lease uuid) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$ UPDATE public.support_settings SET ai_worker_until=NULL,ai_worker_lease=NULL WHERE ai_worker_lease=p_lease $$;
REVOKE ALL ON FUNCTION public.support_cost_worker_claim(uuid),public.support_cost_worker_finish(uuid) FROM PUBLIC,anon,authenticated; GRANT EXECUTE ON FUNCTION public.support_cost_worker_claim(uuid),public.support_cost_worker_finish(uuid) TO service_role;
CREATE OR REPLACE FUNCTION public.support_cost_reserve(p_suggestion uuid,p_phone text,p_number uuid,p_kind text,p_model text,p_tokens bigint) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE st public.support_settings%ROWTYPE; r public.support_ai_daily%ROWTYPE; d date:=(now() AT TIME ZONE 'America/Sao_Paulo')::date; v uuid;
BEGIN
 SELECT * INTO st FROM public.support_settings LIMIT 1 FOR UPDATE;
 IF NOT st.ai_enabled THEN RETURN jsonb_build_object('allowed',false,'reason','ia_desligada'); END IF;
 IF st.ai_pause_reason IS NOT NULL AND (st.ai_pause_until IS NULL OR st.ai_pause_until>now()) THEN RETURN jsonb_build_object('allowed',false,'reason',st.ai_pause_reason); END IF;
 INSERT INTO public.support_ai_daily(day) VALUES(d) ON CONFLICT DO NOTHING;
 SELECT * INTO r FROM public.support_ai_daily WHERE day=d FOR UPDATE;
 IF p_tokens<=0 OR r.tokens+r.reserved+p_tokens>st.ai_daily_token_budget THEN
 UPDATE public.support_ai_daily SET budget_stops=budget_stops+1 WHERE day=d;
 RETURN jsonb_build_object('allowed',false,'reason','teto_diario_tokens','used',r.tokens,'reserved',r.reserved);
 END IF;
 INSERT INTO public.support_ai_calls(suggestion_id,phone,whatsapp_number_id,kind,model,ok,reservation_tokens,settled,budget_day) VALUES(p_suggestion,p_phone,p_number,p_kind,p_model,false,p_tokens,false,d) RETURNING id INTO v;
 UPDATE public.support_ai_daily SET reserved=reserved+p_tokens,calls=calls+1 WHERE day=d;
 RETURN jsonb_build_object('allowed',true,'id',v);
END $$;
CREATE OR REPLACE FUNCTION public.support_cost_settle(p_id uuid,p_input bigint,p_output bigint,p_ok boolean,p_error text,p_run text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ DECLARE c public.support_ai_calls%ROWTYPE; BEGIN
 SELECT * INTO c FROM public.support_ai_calls WHERE id=p_id FOR UPDATE; IF NOT FOUND OR c.settled THEN RETURN; END IF;
 UPDATE public.support_ai_calls SET settled=true,ok=p_ok,error=left(p_error,400),gateway_run_id=p_run,input_tokens=p_input,output_tokens=p_output WHERE id=p_id;
 UPDATE public.support_ai_daily SET reserved=greatest(0,reserved-c.reservation_tokens),tokens=tokens+CASE WHEN p_input IS NULL OR p_output IS NULL THEN c.reservation_tokens ELSE p_input+p_output END WHERE day=c.budget_day;
 END $$;
CREATE OR REPLACE FUNCTION public.support_cost_pause(p_reason text,p_until timestamptz DEFAULT NULL) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$ UPDATE public.support_settings SET ai_pause_reason=left(p_reason,400),ai_pause_until=p_until WHERE ai_pause_reason IS DISTINCT FROM left(p_reason,400) OR ai_pause_until IS DISTINCT FROM p_until $$;
REVOKE ALL ON FUNCTION public.support_cost_reserve(uuid,text,uuid,text,text,bigint),public.support_cost_settle(uuid,bigint,bigint,boolean,text,text),public.support_cost_pause(text,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.support_cost_reserve(uuid,text,uuid,text,text,bigint),public.support_cost_settle(uuid,bigint,bigint,boolean,text,text),public.support_cost_pause(text,timestamptz) TO service_role;
CREATE OR REPLACE FUNCTION public.support_cost_suggestion_count() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ DECLARE d date:=(now() AT TIME ZONE 'America/Sao_Paulo')::date; k text:=NEW.decision; BEGIN IF NEW.cost_prefilter_passed AND NEW.status='nova' AND OLD.status='processando' THEN INSERT INTO public.support_ai_daily(day,suggestions,decisions) VALUES(d,1,jsonb_build_object(k,1)) ON CONFLICT(day) DO UPDATE SET suggestions=support_ai_daily.suggestions+1,decisions=jsonb_set(support_ai_daily.decisions,ARRAY[k],to_jsonb(coalesce((support_ai_daily.decisions->>k)::int,0)+1)); END IF; RETURN NULL; END $$;
REVOKE ALL ON FUNCTION public.support_cost_suggestion_count() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER support_cost_suggestion_count AFTER UPDATE OF status ON public.support_auto_suggestions FOR EACH ROW WHEN(OLD.status IS DISTINCT FROM NEW.status) EXECUTE FUNCTION public.support_cost_suggestion_count();
CREATE OR REPLACE FUNCTION public.support_cost_dashboard() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$ DECLARE d date:=(now() AT TIME ZONE 'America/Sao_Paulo')::date; BEGIN IF NOT public._exchange_desk_staff(auth.uid()) THEN RAISE EXCEPTION 'forbidden'; END IF; RETURN jsonb_build_object('budget',(SELECT ai_daily_token_budget FROM public.support_settings LIMIT 1),'pause',(SELECT ai_pause_reason FROM public.support_settings LIMIT 1),'days',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY day DESC) FROM public.support_ai_daily x WHERE day>=d-6),'[]'::jsonb),'today',d); END $$;
REVOKE ALL ON FUNCTION public.support_cost_dashboard() FROM PUBLIC,anon; GRANT EXECUTE ON FUNCTION public.support_cost_dashboard() TO authenticated;
-- Additive initial summary of previously logged live requests; training is deliberately separate.
INSERT INTO public.support_ai_daily(day,tokens,calls) SELECT (created_at AT TIME ZONE 'America/Sao_Paulo')::date,sum(coalesce(input_tokens,0)+coalesce(output_tokens,0)),count(*) FROM public.support_ai_calls WHERE created_at>=now()-interval '7 days' GROUP BY 1 ON CONFLICT(day) DO UPDATE SET tokens=excluded.tokens,calls=excluded.calls;
