CREATE TABLE public.support_ai_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  suggestion_id uuid NOT NULL REFERENCES public.support_auto_suggestions(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('triagem','agente')),
  attempt smallint NOT NULL CHECK (attempt IN (1,2)),
  model text NOT NULL,
  ok boolean NOT NULL,
  error text,
  duration_ms integer NOT NULL DEFAULT 0 CHECK (duration_ms >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.support_ai_attempts TO authenticated;
GRANT ALL ON public.support_ai_attempts TO service_role;
ALTER TABLE public.support_ai_attempts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin le tentativas de ia" ON public.support_ai_attempts FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE INDEX support_ai_attempts_suggestion_idx ON public.support_ai_attempts(suggestion_id,created_at);
CREATE INDEX support_ai_attempts_health_idx ON public.support_ai_attempts(created_at) INCLUDE (ok);

CREATE OR REPLACE FUNCTION public.support_ai_attempt_log(p_suggestion uuid,p_kind text,p_attempt integer,p_model text,p_ok boolean,p_error text DEFAULT NULL,p_duration integer DEFAULT 0)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_id uuid;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'forbidden'; END IF;
  INSERT INTO public.support_ai_attempts(suggestion_id,kind,attempt,model,ok,error,duration_ms)
  VALUES(p_suggestion,p_kind,p_attempt,left(p_model,200),p_ok,left(p_error,400),greatest(0,least(coalesce(p_duration,0),3600000)))
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.support_ai_attempt_log(uuid,text,integer,text,boolean,text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.support_ai_attempt_log(uuid,text,integer,text,boolean,text,integer) TO service_role;

CREATE OR REPLACE FUNCTION public.support_ai_health_1h()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE v_total integer; v_failed integer; v_rate numeric;
BEGIN
  IF NOT public._exchange_desk_staff(auth.uid()) THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT count(*),count(*) FILTER (WHERE NOT ok) INTO v_total,v_failed
  FROM public.support_ai_attempts WHERE created_at>=now()-interval '1 hour';
  v_rate:=CASE WHEN v_total>0 THEN round((v_failed::numeric/v_total)*100,1) ELSE 0 END;
  RETURN jsonb_build_object('total',v_total,'failed',v_failed,'failure_rate',v_rate,'alert',v_total>0 AND v_failed::numeric/v_total>0.10,'window_minutes',60);
END $$;
REVOKE ALL ON FUNCTION public.support_ai_health_1h() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.support_ai_health_1h() TO authenticated;