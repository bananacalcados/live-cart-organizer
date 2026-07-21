
-- ============================================================================
-- Fase 1: Dicionários de Cor e Tamanho
-- ============================================================================

-- Helper: slug normalizado (lowercase, sem acento, trim, sem espaços múltiplos)
CREATE OR REPLACE FUNCTION public.slugify_dict(_input text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT lower(
    regexp_replace(
      regexp_replace(
        translate(
          coalesce(_input, ''),
          'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑáàâãäéèêëíìîïóòôõöúùûüçñ',
          'AAAAAEEEEIIIIOOOOOUUUUCNaaaaaeeeeiiiiooooouuuucn'
        ),
        '\s+', ' ', 'g'
      ),
      '^\s+|\s+$', '', 'g'
    )
  )
$$;

-- ============================================================================
-- product_colors
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.product_colors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  hex text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_colors TO authenticated;
GRANT ALL ON public.product_colors TO service_role;

ALTER TABLE public.product_colors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "inventory users can view product_colors"
ON public.product_colors FOR SELECT TO authenticated
USING (has_module_access(auth.uid(), 'inventory') OR has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "inventory users can insert product_colors"
ON public.product_colors FOR INSERT TO authenticated
WITH CHECK (has_module_access(auth.uid(), 'inventory') OR has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "inventory users can update product_colors"
ON public.product_colors FOR UPDATE TO authenticated
USING (has_module_access(auth.uid(), 'inventory') OR has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "inventory users can delete product_colors"
ON public.product_colors FOR DELETE TO authenticated
USING (has_module_access(auth.uid(), 'inventory') OR has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER trg_product_colors_updated
BEFORE UPDATE ON public.product_colors
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================================
-- product_sizes
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.product_sizes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label text NOT NULL,
  slug text NOT NULL UNIQUE,
  numeric_value numeric(6,2),
  size_group text NOT NULL DEFAULT 'outro' CHECK (size_group IN ('adulto','infantil','outro')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_sizes TO authenticated;
GRANT ALL ON public.product_sizes TO service_role;

ALTER TABLE public.product_sizes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "inventory users can view product_sizes"
ON public.product_sizes FOR SELECT TO authenticated
USING (has_module_access(auth.uid(), 'inventory') OR has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "inventory users can insert product_sizes"
ON public.product_sizes FOR INSERT TO authenticated
WITH CHECK (has_module_access(auth.uid(), 'inventory') OR has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "inventory users can update product_sizes"
ON public.product_sizes FOR UPDATE TO authenticated
USING (has_module_access(auth.uid(), 'inventory') OR has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "inventory users can delete product_sizes"
ON public.product_sizes FOR DELETE TO authenticated
USING (has_module_access(auth.uid(), 'inventory') OR has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER trg_product_sizes_updated
BEFORE UPDATE ON public.product_sizes
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================================
-- Colunas de vínculo em product_variants
-- ============================================================================
ALTER TABLE public.product_variants
  ADD COLUMN IF NOT EXISTS color_id uuid REFERENCES public.product_colors(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS size_id  uuid REFERENCES public.product_sizes(id)  ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_pv_color_id ON public.product_variants(color_id);
CREATE INDEX IF NOT EXISTS idx_pv_size_id  ON public.product_variants(size_id);

-- ============================================================================
-- Trigger: auto-linkar cor/tamanho ao inserir ou atualizar variante
-- ============================================================================
CREATE OR REPLACE FUNCTION public.auto_link_color_size_variants()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_slug text;
  v_size_num numeric;
  v_size_group text;
BEGIN
  -- Cor
  IF NEW.color IS NOT NULL AND btrim(NEW.color) <> '' AND NEW.color_id IS NULL THEN
    v_slug := slugify_dict(NEW.color);
    IF v_slug <> '' THEN
      INSERT INTO public.product_colors(name, slug)
      VALUES (btrim(NEW.color), v_slug)
      ON CONFLICT (slug) DO NOTHING;
      SELECT id INTO NEW.color_id FROM public.product_colors WHERE slug = v_slug;
    END IF;
  END IF;

  -- Tamanho
  IF NEW.size IS NOT NULL AND btrim(NEW.size) <> '' AND NEW.size_id IS NULL THEN
    v_slug := slugify_dict(NEW.size);
    IF v_slug <> '' THEN
      -- Tenta parsear valor numérico
      BEGIN
        v_size_num := replace(regexp_replace(v_slug, '[^0-9,.]', '', 'g'), ',', '.')::numeric;
      EXCEPTION WHEN OTHERS THEN
        v_size_num := NULL;
      END;
      v_size_group := CASE
        WHEN v_size_num IS NULL THEN 'outro'
        WHEN v_size_num >= 15 AND v_size_num <= 33 THEN 'infantil'
        WHEN v_size_num >= 33 AND v_size_num <= 46 THEN 'adulto'
        ELSE 'outro'
      END;
      INSERT INTO public.product_sizes(label, slug, numeric_value, size_group)
      VALUES (btrim(NEW.size), v_slug, v_size_num, v_size_group)
      ON CONFLICT (slug) DO NOTHING;
      SELECT id INTO NEW.size_id FROM public.product_sizes WHERE slug = v_slug;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_link_color_size_variants ON public.product_variants;
CREATE TRIGGER trg_auto_link_color_size_variants
BEFORE INSERT OR UPDATE OF color, size ON public.product_variants
FOR EACH ROW EXECUTE FUNCTION public.auto_link_color_size_variants();

-- ============================================================================
-- RPC: fundir cor/tamanho (mover FK e apagar registro origem)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.merge_product_color(_source_id uuid, _target_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF _source_id = _target_id THEN RETURN; END IF;
  UPDATE public.product_variants SET color_id = _target_id WHERE color_id = _source_id;
  DELETE FROM public.product_colors WHERE id = _source_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.merge_product_size(_source_id uuid, _target_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF _source_id = _target_id THEN RETURN; END IF;
  UPDATE public.product_variants SET size_id = _target_id WHERE size_id = _source_id;
  DELETE FROM public.product_sizes WHERE id = _source_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.merge_product_color(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.merge_product_size(uuid, uuid)  TO authenticated;

-- ============================================================================
-- Backfill: popular dicionários e vincular variantes existentes
-- ============================================================================

-- Cores
INSERT INTO public.product_colors (name, slug)
SELECT DISTINCT ON (slugify_dict(color)) btrim(color), slugify_dict(color)
FROM public.product_variants
WHERE color IS NOT NULL
  AND btrim(color) <> ''
  AND slugify_dict(color) <> ''
ON CONFLICT (slug) DO NOTHING;

UPDATE public.product_variants pv
SET color_id = pc.id
FROM public.product_colors pc
WHERE pv.color_id IS NULL
  AND pv.color IS NOT NULL
  AND slugify_dict(pv.color) = pc.slug;

-- Tamanhos
INSERT INTO public.product_sizes (label, slug, numeric_value, size_group)
SELECT DISTINCT ON (slugify_dict(size))
  btrim(size),
  slugify_dict(size),
  NULLIF(regexp_replace(replace(slugify_dict(size), ',', '.'), '[^0-9.]', '', 'g'), '')::numeric,
  CASE
    WHEN NULLIF(regexp_replace(replace(slugify_dict(size), ',', '.'), '[^0-9.]', '', 'g'), '')::numeric BETWEEN 15 AND 32 THEN 'infantil'
    WHEN NULLIF(regexp_replace(replace(slugify_dict(size), ',', '.'), '[^0-9.]', '', 'g'), '')::numeric BETWEEN 33 AND 46 THEN 'adulto'
    ELSE 'outro'
  END
FROM public.product_variants
WHERE size IS NOT NULL
  AND btrim(size) <> ''
  AND slugify_dict(size) <> ''
ON CONFLICT (slug) DO NOTHING;

UPDATE public.product_variants pv
SET size_id = ps.id
FROM public.product_sizes ps
WHERE pv.size_id IS NULL
  AND pv.size IS NOT NULL
  AND slugify_dict(pv.size) = ps.slug;
