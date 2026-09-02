ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS wa_initial_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS wa_initial_auto boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS wa_initial_number_id uuid NULL,
  ADD COLUMN IF NOT EXISTS wa_initial_variants jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS wa_initial_rotation integer NOT NULL DEFAULT 0;

-- Rodízio atômico: devolve o índice da próxima variação (0..n-1) e avança o contador.
CREATE OR REPLACE FUNCTION public.next_event_wa_initial_variant(p_event_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
  v_prev integer;
BEGIN
  SELECT COALESCE(jsonb_array_length(wa_initial_variants), 0) INTO v_count
  FROM public.events WHERE id = p_event_id;
  IF v_count IS NULL OR v_count = 0 THEN RETURN NULL; END IF;

  UPDATE public.events
     SET wa_initial_rotation = wa_initial_rotation + 1
   WHERE id = p_event_id
   RETURNING wa_initial_rotation - 1 INTO v_prev;

  RETURN v_prev % v_count;
END;
$$;

-- Modelos reutilizáveis (template API com variáveis / mensagem não-API com variações)
CREATE TABLE IF NOT EXISTS public.event_message_presets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('meta_template', 'wa_initial')),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_message_presets TO authenticated;
GRANT ALL ON public.event_message_presets TO service_role;

ALTER TABLE public.event_message_presets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read presets"
  ON public.event_message_presets FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can insert presets"
  ON public.event_message_presets FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated can update presets"
  ON public.event_message_presets FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated can delete presets"
  ON public.event_message_presets FOR DELETE TO authenticated USING (true);

CREATE TRIGGER trg_event_message_presets_updated_at
  BEFORE UPDATE ON public.event_message_presets
  FOR EACH ROW EXECUTE FUNCTION public._set_updated_at();