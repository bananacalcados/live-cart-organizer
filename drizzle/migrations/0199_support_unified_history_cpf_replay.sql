ALTER TABLE public.support_auto_suggestions ADD COLUMN IF NOT EXISTS other_instances jsonb, ADD COLUMN IF NOT EXISTS consolidation_target jsonb, ADD COLUMN IF NOT EXISTS cpf_different_phone boolean DEFAULT false;
ALTER TABLE public.support_training_items ADD COLUMN IF NOT EXISTS replay_status text, ADD COLUMN IF NOT EXISTS replay_result jsonb, ADD COLUMN IF NOT EXISTS replay_started_at timestamptz;
CREATE INDEX IF NOT EXISTS support_replay_pending ON public.support_training_items(run_id,replay_status);
CREATE INDEX IF NOT EXISTS support_suggestion_suffix_active ON public.support_auto_suggestions ((right(regexp_replace(phone,'\D','','g'),8)),created_at DESC) WHERE status IN ('nova','processando','enviada');
CREATE INDEX IF NOT EXISTS support_sales_cpf ON public.pos_sales ((regexp_replace(customer_cpf,'\D','','g')),created_at DESC) WHERE customer_cpf IS NOT NULL;
CREATE INDEX IF NOT EXISTS support_customers_cpf ON public.pos_customers ((regexp_replace(cpf,'\D','','g'))) WHERE cpf IS NOT NULL;
CREATE INDEX IF NOT EXISTS support_sales_customer_created ON public.pos_sales(customer_id,created_at DESC);
CREATE TABLE public.support_cpf_attempts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),phone_key text NOT NULL,day date NOT NULL DEFAULT (now() AT TIME ZONE 'America/Sao_Paulo')::date,source_key text NOT NULL,cpf_hash text NOT NULL,cpf_mask text NOT NULL,candidate_sale_id uuid,candidate_first_name text,candidate_product text,candidate_month text,confirmed boolean NOT NULL DEFAULT false,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(phone_key,day,source_key));
GRANT ALL ON public.support_cpf_attempts TO service_role;
REVOKE ALL ON public.support_cpf_attempts FROM anon,authenticated;
ALTER TABLE public.support_cpf_attempts ENABLE ROW LEVEL SECURITY;
CREATE INDEX support_cpf_daily ON public.support_cpf_attempts(phone_key,day,created_at DESC);
CREATE OR REPLACE FUNCTION public.support_unified_messages(p_phone text,p_until timestamptz DEFAULT now(),p_limit integer DEFAULT 200) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE k text; r jsonb;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'forbidden'; END IF;
 k:=right(regexp_replace(p_phone,'\D','','g'),8); IF length(k)<>8 THEN RETURN '[]'::jsonb; END IF;
 WITH contacts AS (SELECT c.phone,c.whatsapp_number_id,c.sender_name,n.label FROM public.whatsapp_conversations c LEFT JOIN public.whatsapp_numbers n ON n.id=c.whatsapp_number_id WHERE NOT c.is_group AND c.channel='whatsapp' AND c.phone LIKE '%'||k ORDER BY c.last_message_at DESC LIMIT 30), recent AS (
 SELECT m.*,c.label,c.sender_name FROM contacts c CROSS JOIN LATERAL (
 SELECT x.message,x.direction,x.created_at,x.whatsapp_number_id,x.sender_user_id FROM public.whatsapp_messages x WHERE x.phone=c.phone AND x.whatsapp_number_id IS NOT DISTINCT FROM c.whatsapp_number_id AND x.created_at<=p_until ORDER BY x.created_at DESC LIMIT 60) m
 UNION ALL SELECT m.*,c.label,c.sender_name FROM contacts c CROSS JOIN LATERAL (
 SELECT x.message,x.direction,x.created_at,x.whatsapp_number_id,x.sender_user_id FROM public.whatsapp_messages_archive x WHERE x.phone=c.phone AND x.whatsapp_number_id IS NOT DISTINCT FROM c.whatsapp_number_id AND x.created_at<=p_until ORDER BY x.created_at DESC LIMIT 20) m), bounded AS (SELECT DISTINCT message,direction,created_at,whatsapp_number_id,sender_user_id,label,sender_name FROM recent WHERE message IS NOT NULL ORDER BY created_at DESC LIMIT least(greatest(p_limit,1),200))
 SELECT coalesce(jsonb_agg(jsonb_build_object('text',message,'from',CASE WHEN direction='incoming' THEN 'cliente' ELSE 'loja' END,'at',created_at,'instance_id',whatsapp_number_id,'instance',coalesce(label,'WhatsApp'),'human',sender_user_id IS NOT NULL AND direction='outgoing','customer_name',sender_name) ORDER BY created_at),'[]'::jsonb) INTO r FROM bounded; RETURN r;
END $$;
REVOKE ALL ON FUNCTION public.support_unified_messages(text,timestamptz,integer) FROM PUBLIC,anon,authenticated; GRANT EXECUTE ON FUNCTION public.support_unified_messages(text,timestamptz,integer) TO service_role;
CREATE OR REPLACE FUNCTION public.support_cpf_candidate(p_phone text,p_cpf text,p_source_key text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE k text; d date; a public.support_cpf_attempts%ROWTYPE; sid uuid; cnt integer; sn text; prod text; mon text; norm text;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'forbidden'; END IF;
 k:=right(regexp_replace(p_phone,'\D','','g'),8); norm:=regexp_replace(p_cpf,'\D','','g'); d:=(now() AT TIME ZONE 'America/Sao_Paulo')::date;
 IF length(k)<>8 OR norm !~ '^\d{11}$' THEN RETURN jsonb_build_object('error','cpf_invalido'); END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('support_cpf:'||k||d,0));
 SELECT * INTO a FROM public.support_cpf_attempts WHERE phone_key=k AND day=d AND source_key=p_source_key;
 IF FOUND THEN RETURN jsonb_build_object('id',a.id,'first_name',a.candidate_first_name,'product',a.candidate_product,'month',a.candidate_month,'found',a.candidate_sale_id IS NOT NULL,'mask',a.cpf_mask); END IF;
 IF (SELECT count(*) FROM public.support_cpf_attempts WHERE phone_key=k AND day=d)>=2 THEN RETURN jsonb_build_object('error','limite_2_tentativas'); END IF;
 WITH candidates AS (
 SELECT s.id,s.customer_name,s.created_at FROM public.pos_sales s WHERE s.customer_cpf IS NOT NULL AND regexp_replace(s.customer_cpf,'\D','','g')=norm AND s.status IN ('paid','completed') AND s.status_cancelamento IS DISTINCT FROM 'cancelado' AND s.sales_channel IN ('site','live','link_online','whatsapp') AND s.created_at>now()-interval '60 days'
 UNION SELECT s.id,s.customer_name,s.created_at FROM public.pos_customers c JOIN public.pos_sales s ON s.customer_id=c.id WHERE c.cpf IS NOT NULL AND regexp_replace(c.cpf,'\D','','g')=norm AND s.status IN ('paid','completed') AND s.status_cancelamento IS DISTINCT FROM 'cancelado' AND s.sales_channel IN ('site','live','link_online','whatsapp') AND s.created_at>now()-interval '60 days') SELECT count(*),(array_agg(id ORDER BY created_at DESC))[1] INTO cnt,sid FROM candidates;
 IF cnt=1 THEN SELECT split_part(trim(customer_name),' ',1),to_char(created_at,'MM/YYYY') INTO sn,mon FROM public.pos_sales WHERE id=sid; SELECT product_name INTO prod FROM public.pos_sale_items WHERE sale_id=sid LIMIT 1; ELSE sid:=NULL; END IF;
 INSERT INTO public.support_cpf_attempts(phone_key,day,source_key,cpf_hash,cpf_mask,candidate_sale_id,candidate_first_name,candidate_product,candidate_month) VALUES(k,d,p_source_key,encode(extensions.digest(norm,'sha256'),'hex'),'***.***.***-'||right(norm,2),sid,sn,prod,mon) RETURNING * INTO a;
 RETURN jsonb_build_object('id',a.id,'first_name',sn,'product',prod,'month',mon,'found',sid IS NOT NULL,'multiple',cnt>1,'mask',a.cpf_mask);
END $$;
REVOKE ALL ON FUNCTION public.support_cpf_candidate(text,text,text) FROM PUBLIC,anon,authenticated; GRANT EXECUTE ON FUNCTION public.support_cpf_candidate(text,text,text) TO service_role;
CREATE OR REPLACE FUNCTION public.support_training_replay_claim(p_run uuid,p_n integer DEFAULT 1) RETURNS SETOF public.support_training_items LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'forbidden'; END IF;
 RETURN QUERY UPDATE public.support_training_items t SET replay_status='processando',replay_started_at=now() WHERE t.id IN (SELECT id FROM public.support_training_items WHERE run_id=p_run AND replay_status='pendente' ORDER BY last_incoming_at DESC,id LIMIT least(greatest(p_n,1),2) FOR UPDATE SKIP LOCKED) RETURNING t.*;
END $$;
REVOKE ALL ON FUNCTION public.support_training_replay_claim(uuid,integer) FROM PUBLIC,anon,authenticated; GRANT EXECUTE ON FUNCTION public.support_training_replay_claim(uuid,integer) TO service_role;
ALTER TABLE public.support_auto_suggestions DROP CONSTRAINT IF EXISTS support_auto_suggestions_decision_check;
ALTER TABLE public.support_auto_suggestions ADD CONSTRAINT support_auto_suggestions_decision_check CHECK(decision IN ('enviar_link','presencial','instagram_whatsapp','fila','conversa','consolidar_em_outra_instancia'));
CREATE OR REPLACE FUNCTION public.support_ai_active_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ DECLARE k text; BEGIN
 IF NEW.status NOT IN ('nova','processando') OR NEW.channel<>'whatsapp' THEN RETURN NEW; END IF;
 k:=right(regexp_replace(NEW.phone,'\D','','g'),8); PERFORM pg_advisory_xact_lock(hashtextextended('support_active:'||k,0));
 IF EXISTS(SELECT 1 FROM public.support_auto_suggestions WHERE id<>NEW.id AND right(regexp_replace(phone,'\D','','g'),8)=k AND status IN ('nova','processando') AND (created_at,id)>(NEW.created_at,NEW.id)) THEN NEW.status:='substituida'; RETURN NEW; END IF;
 UPDATE public.support_auto_suggestions SET status='substituida' WHERE id<>NEW.id AND right(regexp_replace(phone,'\D','','g'),8)=k AND status IN ('nova','processando'); RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.support_ai_active_guard() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER support_ai_single_active BEFORE INSERT OR UPDATE OF status ON public.support_auto_suggestions FOR EACH ROW WHEN(NEW.status IN ('nova','processando')) EXECUTE FUNCTION public.support_ai_active_guard();