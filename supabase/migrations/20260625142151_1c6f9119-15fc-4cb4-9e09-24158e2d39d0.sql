-- Tabela leve de públicos reutilizáveis (separada de campanhas_auto)
CREATE TABLE public.campanha_publicos (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  nome text NOT NULL,
  filtro_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.campanha_publicos TO authenticated;
GRANT ALL ON public.campanha_publicos TO service_role;

ALTER TABLE public.campanha_publicos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated manage campanha_publicos"
ON public.campanha_publicos FOR ALL
TO authenticated
USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_campanha_publicos_updated_at
BEFORE UPDATE ON public.campanha_publicos
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Vínculo campanha -> público
ALTER TABLE public.campanhas_auto
  ADD COLUMN IF NOT EXISTS publico_id uuid REFERENCES public.campanha_publicos(id) ON DELETE SET NULL;

-- select_campaign_batch passa a usar o filtro do público vinculado (fallback ao filtro próprio)
CREATE OR REPLACE FUNCTION public.select_campaign_batch(p_campanha_id uuid, p_limit integer DEFAULT NULL::integer, p_global_cap_days integer DEFAULT 7)
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

  -- Prioridade: filtro do público vinculado; fallback ao filtro próprio (legado)
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
    AND NOT EXISTS (
      SELECT 1 FROM public.campanha_envios ce
      WHERE ce.campanha_id = c.id
        AND ce.phone_suffix8 = cv.phone_suffix8
        AND ce.status IN ('enviado','entregue','lido')
        AND ce.enviado_em >= now() - (c.cooldown_dias || ' days')::interval
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.marketing_envios_globais g
      WHERE g.phone_suffix8 = cv.phone_suffix8
        AND g.enviado_em >= now() - (p_global_cap_days || ' days')::interval
    )
  ORDER BY cv.last_purchase_at ASC NULLS FIRST
  LIMIT v_limit;
END;
$function$;