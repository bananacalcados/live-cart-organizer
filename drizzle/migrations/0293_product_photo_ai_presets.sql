CREATE TABLE public.product_photo_ai_presets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE CHECK (char_length(trim(name)) BETWEEN 1 AND 60),
  options jsonb NOT NULL,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON public.product_photo_ai_presets FROM anon, PUBLIC;
GRANT SELECT, INSERT, DELETE ON public.product_photo_ai_presets TO authenticated;
GRANT ALL ON public.product_photo_ai_presets TO service_role;
ALTER TABLE public.product_photo_ai_presets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "inventory read ai presets" ON public.product_photo_ai_presets FOR SELECT TO authenticated
  USING ((select public.has_module_access((select auth.uid()),'inventory')) OR (select public.has_role((select auth.uid()),'admin')));
CREATE POLICY "inventory insert ai presets" ON public.product_photo_ai_presets FOR INSERT TO authenticated
  WITH CHECK ((select public.has_module_access((select auth.uid()),'inventory')) OR (select public.has_role((select auth.uid()),'admin')));
CREATE POLICY "inventory delete ai presets" ON public.product_photo_ai_presets FOR DELETE TO authenticated
  USING ((select public.has_module_access((select auth.uid()),'inventory')) OR (select public.has_role((select auth.uid()),'admin')));