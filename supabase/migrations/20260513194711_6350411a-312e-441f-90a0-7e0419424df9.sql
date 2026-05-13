-- ETAPA 0 do consolidador: normalização de color/size das variações
-- A importação do Tiny grudou tamanho no campo color e vice-versa.
-- Esta migração cria infraestrutura (sem alterar dados) para:
--   1) analisar o que seria mudado (analyze_variant_normalization)
--   2) executar mudanças com snapshot reversível (apply_variant_normalization)

-- ============================================================================
-- 1) Tabela de log/snapshot — permite auditoria e roll-back manual
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.variant_normalization_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  variant_id uuid NOT NULL,
  master_id uuid,
  master_name text,
  old_color text,
  old_size text,
  new_color text,
  new_size text,
  reason text,
  applied_at timestamptz NOT NULL DEFAULT now(),
  applied_by uuid
);

CREATE INDEX IF NOT EXISTS idx_vnl_variant ON public.variant_normalization_log(variant_id);
CREATE INDEX IF NOT EXISTS idx_vnl_applied_at ON public.variant_normalization_log(applied_at DESC);

ALTER TABLE public.variant_normalization_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view normalization log"
  ON public.variant_normalization_log FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- ============================================================================
-- 2) Helper interno: dado (color_raw, size_raw, name), devolve (new_color, new_size)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.normalize_variant_color_size(
  p_color text,
  p_size text,
  p_master_name text DEFAULT NULL
)
RETURNS TABLE(new_color text, new_size text)
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_tokens text[] := ARRAY[]::text[];
  v_tok text;
  v_size text := NULL;
  v_color text := NULL;
  v_color_parts text[] := ARRAY[]::text[];
  v_clean_color text;
  v_clean_size text;
BEGIN
  -- Lista de cores conhecidas (lowercase, sem acento)
  -- Usada pra distinguir token de cor vs token de tamanho não-numérico (ex: "Único")

  -- Junta os 2 campos brutos numa lista de tokens, separando por:
  --   espaços múltiplos, hífen com espaço, barra
  v_clean_color := COALESCE(trim(p_color), '');
  v_clean_size  := COALESCE(trim(p_size), '');

  IF v_clean_color <> '' THEN
    v_tokens := v_tokens || regexp_split_to_array(v_clean_color, '\s*[-/]\s*|\s+');
  END IF;
  IF v_clean_size <> '' THEN
    v_tokens := v_tokens || regexp_split_to_array(v_clean_size, '\s*[-/]\s*|\s+');
  END IF;

  -- Classifica cada token
  FOREACH v_tok IN ARRAY v_tokens LOOP
    v_tok := trim(v_tok);
    CONTINUE WHEN v_tok = '' OR v_tok IS NULL;

    -- Tamanho numérico clássico de calçado (30 a 48)
    IF v_tok ~ '^\d{2}$' AND v_tok::int BETWEEN 30 AND 48 THEN
      IF v_size IS NULL THEN v_size := v_tok; END IF;
    -- Tamanho com unidade (ex: "PP", "P", "M", "G", "GG", "XG", "Único")
    ELSIF upper(v_tok) IN ('PP','P','M','G','GG','XG','XGG','XXG','UNICO','ÚNICO','UN','U') THEN
      IF v_size IS NULL THEN v_size := v_tok; END IF;
    ELSE
      -- Tudo o que sobrar é cor (acumula pra reconstituir cores compostas tipo "Off White")
      v_color_parts := v_color_parts || v_tok;
    END IF;
  END LOOP;

  IF array_length(v_color_parts, 1) > 0 THEN
    v_color := array_to_string(v_color_parts, ' ');
  END IF;

  -- Normaliza capitalização da cor (Title Case simples)
  IF v_color IS NOT NULL THEN
    v_color := initcap(lower(v_color));
  END IF;

  RETURN QUERY SELECT v_color, v_size;
END;
$function$;

-- ============================================================================
-- 3) Análise — não altera dados; retorna preview
-- ============================================================================
CREATE OR REPLACE FUNCTION public.analyze_variant_normalization()
RETURNS TABLE(
  total_variants bigint,
  needs_change bigint,
  swap_only bigint,           -- só troca color<->size
  size_extracted bigint,      -- extraiu tamanho de dentro de "35 Gelo"
  color_extracted bigint,     -- extraiu cor que tava em size
  capitalization_only bigint, -- só mudou capitalização
  no_change bigint,
  empty_after bigint          -- ficou sem color e sem size (suspeito)
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  WITH normalized AS (
    SELECT
      pv.id,
      pv.color AS old_color,
      pv.size AS old_size,
      n.new_color,
      n.new_size
    FROM product_variants pv
    LEFT JOIN products_master pm ON pm.id = pv.master_id
    CROSS JOIN LATERAL public.normalize_variant_color_size(pv.color, pv.size, pm.name) n
  )
  SELECT
    count(*)::bigint AS total_variants,
    count(*) FILTER (
      WHERE COALESCE(old_color,'') <> COALESCE(new_color,'')
         OR COALESCE(old_size,'')  <> COALESCE(new_size,'')
    )::bigint AS needs_change,
    count(*) FILTER (
      WHERE old_color = new_size AND old_size = new_color
        AND old_color IS NOT NULL AND old_size IS NOT NULL
    )::bigint AS swap_only,
    count(*) FILTER (
      WHERE (old_size IS NULL OR old_size = '' OR old_size !~ '^\d{2}$')
        AND new_size ~ '^\d{2}$'
    )::bigint AS size_extracted,
    count(*) FILTER (
      WHERE (old_color IS NULL OR old_color = '' OR old_color ~ '^\d')
        AND new_color IS NOT NULL AND new_color !~ '^\d'
    )::bigint AS color_extracted,
    count(*) FILTER (
      WHERE lower(COALESCE(old_color,'')) = lower(COALESCE(new_color,''))
        AND lower(COALESCE(old_size,''))  = lower(COALESCE(new_size,''))
        AND (COALESCE(old_color,'') <> COALESCE(new_color,'')
             OR COALESCE(old_size,'') <> COALESCE(new_size,''))
    )::bigint AS capitalization_only,
    count(*) FILTER (
      WHERE COALESCE(old_color,'') = COALESCE(new_color,'')
        AND COALESCE(old_size,'')  = COALESCE(new_size,'')
    )::bigint AS no_change,
    count(*) FILTER (
      WHERE (new_color IS NULL OR new_color = '')
        AND (new_size IS NULL OR new_size = '')
        AND (COALESCE(old_color,'') <> '' OR COALESCE(old_size,'') <> '')
    )::bigint AS empty_after
  FROM normalized;
END;
$function$;

-- ============================================================================
-- 4) Amostra para revisão visual (top 50)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.sample_variant_normalization(p_limit int DEFAULT 50)
RETURNS TABLE(
  variant_id uuid,
  master_name text,
  old_color text,
  old_size text,
  new_color text,
  new_size text,
  change_type text
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH normalized AS (
    SELECT
      pv.id AS variant_id,
      pm.name AS master_name,
      pv.color AS old_color,
      pv.size AS old_size,
      n.new_color,
      n.new_size
    FROM product_variants pv
    LEFT JOIN products_master pm ON pm.id = pv.master_id
    CROSS JOIN LATERAL public.normalize_variant_color_size(pv.color, pv.size, pm.name) n
    WHERE pv.color IS NOT NULL OR pv.size IS NOT NULL
  )
  SELECT
    variant_id, master_name, old_color, old_size, new_color, new_size,
    CASE
      WHEN old_color = new_size AND old_size = new_color THEN 'swap'
      WHEN (old_size IS NULL OR old_size !~ '^\d{2}$') AND new_size ~ '^\d{2}$' THEN 'extract_size'
      WHEN (new_color IS NULL OR new_color = '') AND (new_size IS NULL OR new_size = '') THEN 'empty_result'
      WHEN lower(COALESCE(old_color,'')) = lower(COALESCE(new_color,''))
        AND lower(COALESCE(old_size,'')) = lower(COALESCE(new_size,'')) THEN 'capitalization'
      ELSE 'other'
    END AS change_type
  FROM normalized
  WHERE COALESCE(old_color,'') <> COALESCE(new_color,'')
     OR COALESCE(old_size,'')  <> COALESCE(new_size,'')
  ORDER BY change_type, master_name
  LIMIT p_limit;
$function$;

-- ============================================================================
-- 5) Execução — aplica em lote, gravando snapshot
-- ============================================================================
CREATE OR REPLACE FUNCTION public.apply_variant_normalization(
  p_dry_run boolean DEFAULT true,
  p_limit int DEFAULT NULL
)
RETURNS TABLE(updated_count bigint, skipped_empty bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_updated bigint := 0;
  v_skipped bigint := 0;
  v_user uuid := auth.uid();
  rec record;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only admins can normalize variants';
  END IF;

  FOR rec IN
    WITH normalized AS (
      SELECT
        pv.id AS variant_id,
        pv.master_id,
        pm.name AS master_name,
        pv.color AS old_color,
        pv.size AS old_size,
        n.new_color,
        n.new_size
      FROM product_variants pv
      LEFT JOIN products_master pm ON pm.id = pv.master_id
      CROSS JOIN LATERAL public.normalize_variant_color_size(pv.color, pv.size, pm.name) n
      WHERE COALESCE(pv.color,'') <> COALESCE(n.new_color,'')
         OR COALESCE(pv.size,'')  <> COALESCE(n.new_size,'')
    )
    SELECT * FROM normalized
    LIMIT COALESCE(p_limit, 1000000)
  LOOP
    -- Pula casos perigosos: ficou tudo vazio (provavelmente parser não soube o que fazer)
    IF (rec.new_color IS NULL OR rec.new_color = '')
       AND (rec.new_size IS NULL OR rec.new_size = '')
       AND (COALESCE(rec.old_color,'') <> '' OR COALESCE(rec.old_size,'') <> '')
    THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    IF NOT p_dry_run THEN
      -- Snapshot ANTES
      INSERT INTO public.variant_normalization_log (
        variant_id, master_id, master_name, old_color, old_size, new_color, new_size, reason, applied_by
      ) VALUES (
        rec.variant_id, rec.master_id, rec.master_name,
        rec.old_color, rec.old_size, rec.new_color, rec.new_size,
        'auto_normalize', v_user
      );

      -- Update — usa NULL pra strings vazias pra não quebrar unique nulls
      BEGIN
        UPDATE public.product_variants
           SET color = NULLIF(rec.new_color, ''),
               size  = NULLIF(rec.new_size, ''),
               updated_at = now()
         WHERE id = rec.variant_id;
      EXCEPTION WHEN unique_violation THEN
        -- Colidiu com outra variação do mesmo master que já tem (color, size).
        -- Não quebra: registra reason e segue. A consolidação (etapa 2) vai mesclar.
        UPDATE public.variant_normalization_log
           SET reason = 'unique_violation_skipped'
         WHERE variant_id = rec.variant_id
           AND applied_at >= now() - interval '5 seconds';
        v_skipped := v_skipped + 1;
        CONTINUE;
      END;
    END IF;

    v_updated := v_updated + 1;
  END LOOP;

  RETURN QUERY SELECT v_updated, v_skipped;
END;
$function$;