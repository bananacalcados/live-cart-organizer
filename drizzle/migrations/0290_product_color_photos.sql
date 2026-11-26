CREATE TABLE public.product_color_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  master_id uuid NOT NULL REFERENCES public.products_master(id) ON DELETE CASCADE,
  color_key text NOT NULL CHECK (color_key ~ '^[a-z0-9][a-z0-9_-]{0,59}$'),
  color text,
  photo_id text NOT NULL CHECK (photo_id ~ '^[0-9a-f]{32}$'),
  url_thumb text NOT NULL CHECK (url_thumb LIKE 'https://fotos.servidorbanana.com/%'),
  url_medium text NOT NULL CHECK (url_medium LIKE 'https://fotos.servidorbanana.com/%'),
  url_full text NOT NULL CHECK (url_full LIKE 'https://fotos.servidorbanana.com/%'),
  width int, height int,
  position int NOT NULL DEFAULT 0,
  source text NOT NULL DEFAULT 'upload',
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (master_id, color_key, photo_id)
);
CREATE INDEX idx_product_color_photos_master_color_pos
  ON public.product_color_photos (master_id, color_key, position);

REVOKE ALL ON public.product_color_photos FROM anon, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_color_photos TO authenticated;
GRANT ALL ON public.product_color_photos TO service_role;
ALTER TABLE public.product_color_photos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "inventory users view color photos" ON public.product_color_photos
  FOR SELECT TO authenticated
  USING (public.has_module_access(auth.uid(),'inventory') OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "inventory users insert color photos" ON public.product_color_photos
  FOR INSERT TO authenticated
  WITH CHECK (public.has_module_access(auth.uid(),'inventory') OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "inventory users update color photos" ON public.product_color_photos
  FOR UPDATE TO authenticated
  USING (public.has_module_access(auth.uid(),'inventory') OR public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_module_access(auth.uid(),'inventory') OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "inventory users delete color photos" ON public.product_color_photos
  FOR DELETE TO authenticated
  USING (public.has_module_access(auth.uid(),'inventory') OR public.has_role(auth.uid(),'admin'));

CREATE OR REPLACE FUNCTION public.can_upload_product_photos()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN auth.uid() IS NULL THEN false
    ELSE (public.has_module_access(auth.uid(),'inventory') OR public.has_role(auth.uid(),'admin')) END
$$;
REVOKE ALL ON FUNCTION public.can_upload_product_photos() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_upload_product_photos() TO authenticated;