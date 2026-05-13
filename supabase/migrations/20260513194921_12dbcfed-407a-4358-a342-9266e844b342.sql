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
  v_color_parts text[] := ARRAY[]::text[];
  v_color text := NULL;
  v_clean_color text;
  v_clean_size text;
BEGIN
  v_clean_color := COALESCE(trim(p_color), '');
  v_clean_size  := COALESCE(trim(p_size), '');

  IF v_clean_color <> '' THEN
    v_tokens := v_tokens || regexp_split_to_array(v_clean_color, '\s*[-/]\s*|\s+');
  END IF;
  IF v_clean_size <> '' THEN
    v_tokens := v_tokens || regexp_split_to_array(v_clean_size, '\s*[-/]\s*|\s+');
  END IF;

  FOREACH v_tok IN ARRAY v_tokens LOOP
    v_tok := trim(v_tok);
    CONTINUE WHEN v_tok = '' OR v_tok IS NULL;

    -- Tamanho numérico de calçado: 16 a 48 (cobre infantil + adulto)
    IF v_tok ~ '^\d{2}$' AND v_tok::int BETWEEN 16 AND 48 THEN
      IF v_size IS NULL THEN v_size := v_tok; END IF;
    -- Tamanho com letra (PP/P/M/G/GG/XG, Único)
    ELSIF upper(v_tok) IN ('PP','P','M','G','GG','XG','XGG','XXG','UNICO','ÚNICO','UN','U') THEN
      IF v_size IS NULL THEN v_size := v_tok; END IF;
    ELSE
      v_color_parts := v_color_parts || v_tok;
    END IF;
  END LOOP;

  IF array_length(v_color_parts, 1) > 0 THEN
    v_color := array_to_string(v_color_parts, ' ');
    v_color := initcap(lower(v_color));
  END IF;

  RETURN QUERY SELECT v_color, v_size;
END;
$function$;