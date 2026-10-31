ALTER TABLE public.live_overlay_templates ADD COLUMN fixed_token uuid;
CREATE UNIQUE INDEX live_overlay_templates_fixed_token_uq ON public.live_overlay_templates(fixed_token) WHERE fixed_token IS NOT NULL;
CREATE UNIQUE INDEX live_overlay_templates_single_fixed_uq ON public.live_overlay_templates((fixed_token IS NOT NULL)) WHERE fixed_token IS NOT NULL;
COMMENT ON COLUMN public.live_overlay_templates.fixed_token IS 'Stable OBS capability reused from the latest live; independent of per-event token rotation.';
CREATE OR REPLACE FUNCTION public.overlay_fixed_token()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT fixed_token FROM live_overlay_templates WHERE fixed_token IS NOT NULL LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.overlay_fixed_token() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.overlay_fixed_token() TO authenticated,service_role;
CREATE OR REPLACE FUNCTION public.overlay_initialize_event()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_config jsonb; v_layout jsonb;
BEGIN
 IF NOT EXISTS (SELECT 1 FROM live_overlay_templates WHERE fixed_token IS NOT NULL) THEN RETURN NEW; END IF;
 SELECT config INTO v_config FROM live_overlay_templates WHERE is_default ORDER BY created_at DESC LIMIT 1;
 SELECT s.config->'layout' INTO v_layout FROM events e JOIN live_overlay_settings s ON s.event_id=e.id
 WHERE e.id<>NEW.id AND e.created_at<=NEW.created_at AND jsonb_typeof(s.config->'layout')='object'
 ORDER BY e.created_at DESC,e.id DESC LIMIT 1;
 IF v_layout IS NULL THEN SELECT config->'layout' INTO v_layout FROM live_overlay_templates WHERE fixed_token IS NOT NULL LIMIT 1; END IF;
 INSERT INTO live_overlay_settings(event_id,config) VALUES(NEW.id,coalesce(v_config,'{}'::jsonb)||jsonb_build_object('layout',coalesce(v_layout,'{}'::jsonb))) ON CONFLICT(event_id) DO NOTHING;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.overlay_initialize_event() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER trg_overlay_initialize_event AFTER INSERT ON public.events FOR EACH ROW EXECUTE FUNCTION public.overlay_initialize_event();
CREATE OR REPLACE FUNCTION public.overlay_pull(p_token uuid,p_after_id bigint DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE v_event uuid; v_after bigint:=coalesce(p_after_id,0); v_settings jsonb;
BEGIN
 IF EXISTS(SELECT 1 FROM live_overlay_templates WHERE fixed_token=p_token) THEN
  SELECT id INTO v_event FROM events ORDER BY created_at DESC,id DESC LIMIT 1;
 ELSE
  SELECT id INTO v_event FROM events WHERE overlay_token=p_token;
 END IF;
 IF v_event IS NULL THEN RETURN jsonb_build_object('error','invalid_token'); END IF;
 IF v_after<=0 THEN SELECT coalesce(max(id),0) INTO v_after FROM live_overlay_events WHERE event_id=v_event; END IF;
 SELECT jsonb_build_object('config',config,'hidden',hidden) INTO v_settings FROM live_overlay_settings WHERE event_id=v_event;
 RETURN jsonb_build_object('event_id',v_event,'settings',v_settings,'raffle_count',public.overlay_raffle_count(v_event),'last_id',v_after,
 'events',coalesce((SELECT jsonb_agg(x ORDER BY x.id) FROM(SELECT id,kind,payload,created_at FROM live_overlay_events WHERE event_id=v_event AND id>v_after ORDER BY id LIMIT 50)x),'[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.overlay_pull(uuid,bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.overlay_pull(uuid,bigint) TO anon,authenticated,service_role;