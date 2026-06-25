-- Corrige timeout no botão "Iniciar disparos agora".
-- Mantém as regras atuais, mas troca a checagem pesada via view marketing_envios_globais
-- por consultas diretas em tabelas com índices por sufixo do telefone.

CREATE INDEX IF NOT EXISTS idx_campanha_envios_campaign_suffix_status_sent
  ON public.campanha_envios (campanha_id, phone_suffix8, status, enviado_em DESC)
  WHERE phone_suffix8 IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_campanha_envios_global_suffix_sent
  ON public.campanha_envios (phone_suffix8, enviado_em DESC)
  WHERE phone_suffix8 IS NOT NULL
    AND status IN ('enviado','entregue','lido');

CREATE INDEX IF NOT EXISTS idx_dispatch_recipients_suffix_sent_recent
  ON public.dispatch_recipients (
    (right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 8)),
    (coalesce(sent_at, created_at)) DESC
  )
  WHERE status IN ('sent','delivered','read');

CREATE INDEX IF NOT EXISTS idx_automation_dispatch_sent_suffix_sent_recent
  ON public.automation_dispatch_sent (
    (right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 8)),
    sent_at DESC
  )
  WHERE sent_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_customers_unified_active_dispatch_order
  ON public.customers_unified (last_purchase_at ASC NULLS FIRST)
  WHERE phone_suffix8 IS NOT NULL
    AND COALESCE(opt_out_mass_dispatch, false) = false
    AND COALESCE(is_archived, false) = false;

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

    -- Exclui quem já recebeu / está na fila desta campanha.
    AND NOT EXISTS (
      SELECT 1
      FROM public.campanha_envios ce
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

    -- Teto global de N dias. Antes isso consultava a view marketing_envios_globais,
    -- que calculava telefone por regex em tabelas grandes e podia estourar timeout.
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

REVOKE ALL ON FUNCTION public.select_campaign_batch(uuid, integer, integer, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.select_campaign_batch(uuid, integer, integer, boolean) TO authenticated, service_role;