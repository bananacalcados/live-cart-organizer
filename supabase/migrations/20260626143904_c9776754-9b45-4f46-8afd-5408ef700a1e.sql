CREATE OR REPLACE FUNCTION public.select_campaign_batch(p_campanha_id uuid, p_limit integer DEFAULT NULL::integer, p_global_cap_days integer DEFAULT 7, p_ignore_global_cap boolean DEFAULT false)
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
  global_cutoff timestamptz;
BEGIN
  SELECT * INTO c FROM public.campanhas_auto WHERE id = p_campanha_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  v_limit := GREATEST(1, COALESCE(p_limit, c.qtd_por_dia, 50));
  global_cutoff := now() - (COALESCE(p_global_cap_days, 7) || ' days')::interval;

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

    -- Exclui quem já recebeu / está na fila / já falhou definitivamente nesta campanha.
    AND NOT EXISTS (
      SELECT 1
      FROM public.campanha_envios ce
      WHERE ce.campanha_id = c.id
        AND ce.phone_suffix8 = cv.phone_suffix8
        AND (
          ce.status = 'pendente'
          OR ce.status IN ('nao_entregavel','falhou','capped')
          OR (
            ce.status IN ('enviado','entregue','lido')
            AND (
              p_ignore_global_cap
              OR ce.enviado_em >= now() - (c.cooldown_dias || ' days')::interval
            )
          )
        )
    )

    AND (
      p_ignore_global_cap
      OR (
        NOT EXISTS (
          SELECT 1
          FROM public.campanha_envios ce2
          WHERE ce2.phone_suffix8 = cv.phone_suffix8
            AND ce2.status IN ('enviado','entregue','lido')
            AND ce2.enviado_em >= global_cutoff
        )
        AND NOT EXISTS (
          SELECT 1
          FROM public.dispatch_recipients dr
          WHERE right(regexp_replace(coalesce(dr.phone, ''), '\D', '', 'g'), 8) = cv.phone_suffix8
            AND dr.status IN ('sent','delivered','read')
            AND coalesce(dr.sent_at, dr.created_at) >= global_cutoff
        )
        AND NOT EXISTS (
          SELECT 1
          FROM public.automation_dispatch_sent ads
          WHERE right(regexp_replace(coalesce(ads.phone, ''), '\D', '', 'g'), 8) = cv.phone_suffix8
            AND ads.sent_at >= global_cutoff
        )
      )
    )
  ORDER BY cv.last_purchase_at ASC NULLS FIRST
  LIMIT v_limit;
END;
$function$;

CREATE OR REPLACE FUNCTION public.campaign_daily_deficit(p_campanha_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH cfg AS (
    SELECT qtd_por_dia FROM public.campanhas_auto WHERE id = p_campanha_id
  ),
  started_today AS (
    SELECT 1
    FROM public.campanha_envios ce
    WHERE ce.campanha_id = p_campanha_id
      AND (ce.created_at AT TIME ZONE 'America/Sao_Paulo')::date
          = (now() AT TIME ZONE 'America/Sao_Paulo')::date
    LIMIT 1
  ),
  ok_today AS (
    SELECT count(*)::int AS n
    FROM public.campanha_envios ce
    WHERE ce.campanha_id = p_campanha_id
      AND ce.status IN ('enviado','entregue','lido')
      AND (ce.enviado_em AT TIME ZONE 'America/Sao_Paulo')::date
          = (now() AT TIME ZONE 'America/Sao_Paulo')::date
  ),
  pendentes AS (
    SELECT count(*)::int AS n
    FROM public.campanha_envios ce
    WHERE ce.campanha_id = p_campanha_id
      AND ce.status = 'pendente'
  )
  SELECT CASE
    WHEN NOT EXISTS (SELECT 1 FROM started_today) THEN 0
    ELSE GREATEST(0,
      COALESCE((SELECT qtd_por_dia FROM cfg), 0)
      - (SELECT n FROM ok_today)
      - (SELECT n FROM pendentes)
    )
  END;
$function$;

GRANT EXECUTE ON FUNCTION public.campaign_daily_deficit(uuid) TO authenticated, service_role;