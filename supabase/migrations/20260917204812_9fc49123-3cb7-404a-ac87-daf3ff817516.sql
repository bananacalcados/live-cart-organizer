CREATE TABLE public.module_access_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  user_email text,
  module text NOT NULL,
  route text,
  event_id uuid,
  ip text,
  user_agent text,
  hits integer NOT NULL DEFAULT 1,
  bucket_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.module_access_log TO authenticated;
GRANT ALL ON public.module_access_log TO service_role;

ALTER TABLE public.module_access_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read access log"
ON public.module_access_log FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE UNIQUE INDEX module_access_log_bucket_uniq
  ON public.module_access_log (user_id, module, bucket_at, coalesce(event_id, '00000000-0000-0000-0000-000000000000'::uuid));
CREATE INDEX module_access_log_created_idx ON public.module_access_log (created_at DESC);
CREATE INDEX module_access_log_user_idx ON public.module_access_log (user_id, created_at DESC);
CREATE INDEX module_access_log_event_idx ON public.module_access_log (event_id);

CREATE OR REPLACE FUNCTION public.log_module_access(p_module text, p_route text DEFAULT NULL, p_event_id uuid DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_email text;
  v_headers json;
  v_ip text;
  v_ua text;
  v_bucket timestamptz := to_timestamp(floor(extract(epoch from now()) / 300) * 300);
BEGIN
  IF v_uid IS NULL OR p_module IS NULL THEN
    RETURN;
  END IF;

  SELECT email INTO v_email FROM auth.users WHERE id = v_uid;

  BEGIN
    v_headers := current_setting('request.headers', true)::json;
    v_ip := split_part(coalesce(v_headers ->> 'x-forwarded-for', ''), ',', 1);
    v_ua := v_headers ->> 'user-agent';
  EXCEPTION WHEN OTHERS THEN
    v_ip := NULL; v_ua := NULL;
  END;

  IF v_ip = '' THEN v_ip := NULL; END IF;

  INSERT INTO public.module_access_log (user_id, user_email, module, route, event_id, ip, user_agent, bucket_at)
  VALUES (v_uid, v_email, p_module, p_route, p_event_id, v_ip, v_ua, v_bucket)
  ON CONFLICT (user_id, module, bucket_at, coalesce(event_id, '00000000-0000-0000-0000-000000000000'::uuid))
  DO UPDATE SET hits = public.module_access_log.hits + 1,
                updated_at = now(),
                route = coalesce(EXCLUDED.route, public.module_access_log.route);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.log_module_access(text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.log_module_access(text, text, uuid) TO authenticated;