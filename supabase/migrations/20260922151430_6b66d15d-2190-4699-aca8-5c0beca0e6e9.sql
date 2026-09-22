ALTER TABLE public.message_templates
  ADD COLUMN IF NOT EXISTS funnel_step smallint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS variants jsonb NOT NULL DEFAULT '[]'::jsonb;

UPDATE public.message_templates
SET variants = jsonb_build_array(message)
WHERE (variants IS NULL OR jsonb_array_length(variants) = 0) AND message IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.template_step_rotation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  funnel_step smallint NOT NULL,
  scope_key text NOT NULL DEFAULT 'global',
  counter integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (funnel_step, scope_key)
);

GRANT SELECT, INSERT, UPDATE ON public.template_step_rotation TO authenticated;
GRANT ALL ON public.template_step_rotation TO service_role;

ALTER TABLE public.template_step_rotation ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Equipe gerencia rodizio de templates" ON public.template_step_rotation;
CREATE POLICY "Equipe gerencia rodizio de templates"
  ON public.template_step_rotation FOR ALL
  TO authenticated
  USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.next_template_variant(
  p_step smallint,
  p_scope text,
  p_count integer
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_counter integer;
BEGIN
  IF p_count IS NULL OR p_count <= 0 THEN
    RETURN 0;
  END IF;

  INSERT INTO public.template_step_rotation (funnel_step, scope_key, counter)
  VALUES (p_step, COALESCE(NULLIF(p_scope, ''), 'global'), 1)
  ON CONFLICT (funnel_step, scope_key)
  DO UPDATE SET counter = public.template_step_rotation.counter + 1, updated_at = now()
  RETURNING counter INTO v_counter;

  RETURN (v_counter - 1) % p_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.next_template_variant(smallint, text, integer) TO authenticated, service_role;