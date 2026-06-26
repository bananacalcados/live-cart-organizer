CREATE OR REPLACE FUNCTION public.select_campaign_batch(p_campanha_id uuid, p_limit integer DEFAULT NULL::integer, p_global_cap_days integer DEFAULT 0, p_ignore_global_cap boolean DEFAULT false)
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

  v_limit := GREATEST(1, COALESCE(p_limit, c.qtd_por_dia, 50));

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

  -- IMPORTANTE: as automações da Frente de Caixa NÃO aplicam mais o teto global
  -- de tempo (anti-spam de 7 dias dos disparos em massa do Marketing). As
  -- automações são a base central da comunicação e têm prioridade. O cooldown
  -- por tempo é responsabilidade exclusiva do módulo Marketing > Disparos em massa.
  --
  -- Mantemos apenas a proteção anti-duplicidade DENTRO da própria automação:
  -- nunca reenvia para quem já recebeu, está na fila ou falhou definitivamente
  -- nesta mesma campanha. Pessoas novas que passam a se encaixar nos filtros
  -- entram automaticamente a cada ciclo (público recalculado ao vivo).
  RETURN QUERY
  SELECT cv.id, cv.phone, cv.phone_suffix8, cv.name, cv.first_name, cv.purchased_sizes
  FROM public.crm_customers_v cv
  WHERE cv.phone_suffix8 IS NOT NULL
    AND cv.phone IS NOT NULL
    AND COALESCE(cv.opt_out_mass_dispatch, false) = false
    AND COALESCE(cv.is_archived, false) = false
    AND public.bc_match_audience(cv, inc, exc)
    AND NOT EXISTS (
      SELECT 1
      FROM public.campanha_envios ce
      WHERE ce.campanha_id = c.id
        AND ce.phone_suffix8 = cv.phone_suffix8
        AND ce.status IN ('pendente','enviado','entregue','lido','nao_entregavel','falhou','capped')
    )
  ORDER BY cv.last_purchase_at ASC NULLS FIRST
  LIMIT v_limit;
END;
$function$;