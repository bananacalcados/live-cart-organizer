CREATE TABLE public.access_log (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), created_at timestamptz NOT NULL DEFAULT now(), function_name text NOT NULL, method text, path text, ip text, ip_chain text, user_agent text, origin text, referer text, session_id text, user_id uuid, user_email text, http_status integer, duration_ms integer, blocked boolean NOT NULL DEFAULT false, reason text
);
GRANT SELECT ON public.access_log TO authenticated;
GRANT ALL ON public.access_log TO service_role;
ALTER TABLE public.access_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY admin_read ON public.access_log FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));
CREATE INDEX access_log_created_at_idx ON public.access_log(created_at DESC);
CREATE INDEX access_log_ip_idx ON public.access_log(ip,created_at DESC);
CREATE INDEX access_log_function_name_idx ON public.access_log(function_name,created_at DESC);
CREATE INDEX access_log_user_id_idx ON public.access_log(user_id,created_at DESC);
CREATE TABLE public.admin_access_log (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, email text, event text NOT NULL, module text, ip text, user_agent text, created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.admin_access_log TO authenticated;
GRANT ALL ON public.admin_access_log TO service_role;
ALTER TABLE public.admin_access_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY admin_read ON public.admin_access_log FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));
CREATE INDEX admin_access_log_created_at_idx ON public.admin_access_log(created_at DESC);
CREATE INDEX admin_access_log_user_ip_idx ON public.admin_access_log(user_id,ip,created_at DESC);
CREATE TABLE public.security_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), created_at timestamptz NOT NULL DEFAULT now(), event text NOT NULL, user_id uuid, ip text, details jsonb NOT NULL DEFAULT '{}'::jsonb
);
GRANT SELECT ON public.security_events TO authenticated;
GRANT ALL ON public.security_events TO service_role;
ALTER TABLE public.security_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY admin_read ON public.security_events FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));
CREATE INDEX security_events_created_at_idx ON public.security_events(created_at DESC);
CREATE OR REPLACE FUNCTION public.record_admin_access(p_user_id uuid,p_email text,p_event text,p_module text,p_ip text,p_user_agent text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $fn$
BEGIN
 IF p_event='login' AND p_user_id IS NOT NULL AND p_ip IS NOT NULL AND public.has_role(p_user_id,'admin') THEN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text||':'||p_ip,0));
  IF NOT EXISTS (SELECT 1 FROM public.admin_access_log WHERE user_id=p_user_id AND ip=p_ip AND event='login') THEN
   INSERT INTO public.security_events(event,user_id,ip,details) VALUES ('admin_new_ip',p_user_id,left(p_ip,500),jsonb_build_object('email',left(p_email,500)));
  END IF;
 END IF;
 INSERT INTO public.admin_access_log(user_id,email,event,module,ip,user_agent) VALUES(p_user_id,left(p_email,500),left(p_event,500),left(p_module,500),left(p_ip,500),left(p_user_agent,500));
END $fn$;
REVOKE ALL ON FUNCTION public.record_admin_access(uuid,text,text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_admin_access(uuid,text,text,text,text,text) TO service_role;
COMMENT ON TABLE public.access_log IS 'Security access history: indefinite retention. Never log body, authorization, API keys, cookies or URL query values.';
COMMENT ON TABLE public.admin_access_log IS 'Server-observed auth and sensitive actions. Browser event claims are not authoritative proof of login/logout.';