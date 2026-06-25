DROP FUNCTION IF EXISTS public.select_campaign_batch(uuid, integer, integer);

CREATE OR REPLACE FUNCTION public.select_campaign_batch(
  p_campanha_id uuid,
  p_limit integer DEFAULT NULL::integer,
  p_global_cap_days integer DEFAULT 7,
  p_ignore_global_cap boolean DEFAULT false
)
 RETURNS TABLE(cliente_id uuid, phone text, phone_suffix8 text, nome text, primeiro_nome text, tamanhos text[])
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  c public.campanhas_auto;
  v_limit integer;
  f jsonb;
  inc jsonb;
  exc jsonb;
BEGIN
  SELECT * INTO c FROM public.campanhas_auto WHERE id = p_campanha_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  v_limit := COALESCE(p_limit, c.qtd_por_dia, 50);

  f := NULL;
  IF c.publico_id IS NOT NULL THEN
    SELECT filtro_json INTO f FROM public.campanha_publicos WHERE id = c.publico_id;
  END IF;
  f := COALESCE(f, c.filtro_json, '{}'::jsonb);

  IF f ? 'include' OR f ? 'exclude' THEN
    inc := COALESCE(f->'include', '{}'::jsonb);
    exc := COALESCE(f->'exclude', '{}'::jsonb);
  ELSE
    inc := f;
    exc := '{}'::jsonb;
  END IF;

  RETURN QUERY
  SELECT cv.id, cv.phone, cv.phone_suffix8, cv.name, cv.first_name, cv.purchased_sizes
  FROM public.crm_customers_v cv
  WHERE cv.phone_suffix8 IS NOT NULL
    AND cv.phone IS NOT NULL
    AND COALESCE(cv.opt_out_mass_dispatch, false) = false
    AND COALESCE(cv.is_archived, false) = false
    AND public.bc_match_audience(cv, inc, exc)
    -- Exclui quem já recebeu / está na fila DESTA campanha.
    -- Em modo normal respeita o cooldown da campanha; em modo forçado
    -- exclui qualquer envio já realizado (independente do tempo).
    AND NOT EXISTS (
      SELECT 1 FROM public.campanha_envios ce
      WHERE ce.campanha_id = c.id
        AND ce.phone_suffix8 = cv.phone_suffix8
        AND (
          ce.status = 'pendente'
          OR (
            ce.status IN ('enviado','entregue','lido')
            AND (
              p_ignore_global_cap
              OR ce.enviado_em >= now() - (c.cooldown_dias || ' days')::interval
            )
          )
        )
    )
    -- Teto global de N dias (apenas templates/disparos em massa, via view
    -- marketing_envios_globais). Ignorado quando p_ignore_global_cap = true.
    AND (
      p_ignore_global_cap
      OR NOT EXISTS (
        SELECT 1 FROM public.marketing_envios_globais g
        WHERE g.phone_suffix8 = cv.phone_suffix8
          AND g.enviado_em >= now() - (p_global_cap_days || ' days')::interval
      )
    )
  ORDER BY cv.last_purchase_at ASC NULLS FIRST
  LIMIT v_limit;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.select_campaign_batch(uuid, integer, integer, boolean) TO authenticated, service_role;