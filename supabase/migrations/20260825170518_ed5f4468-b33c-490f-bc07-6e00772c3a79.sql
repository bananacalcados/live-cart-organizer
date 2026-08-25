ALTER TABLE public.event_typebots ALTER COLUMN event_id DROP NOT NULL;
ALTER TABLE public.event_typebots ADD COLUMN IF NOT EXISTS is_global boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.resolve_typebot_event_id(p_typebot_id uuid)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event_id uuid;
BEGIN
  SELECT event_id INTO v_event_id FROM public.event_typebots WHERE id = p_typebot_id;
  IF v_event_id IS NOT NULL THEN
    RETURN v_event_id;
  END IF;

  SELECT id INTO v_event_id
  FROM public.events
  WHERE live_active_until IS NOT NULL AND live_active_until > now()
  ORDER BY live_active_until DESC
  LIMIT 1;
  IF v_event_id IS NOT NULL THEN
    RETURN v_event_id;
  END IF;

  SELECT id INTO v_event_id
  FROM public.events
  ORDER BY created_at DESC
  LIMIT 1;
  RETURN v_event_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.resolve_typebot_event_id(uuid) TO anon, authenticated, service_role;