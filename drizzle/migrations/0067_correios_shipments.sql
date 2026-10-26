CREATE TABLE public.correios_shipments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id uuid NOT NULL,
  group_id uuid,
  sale_ids uuid[] NOT NULL DEFAULT '{}',
  prepostagem_id text,
  codigo_objeto text,
  servico_codigo text NOT NULL,
  servico_nome text,
  status text NOT NULL DEFAULT 'criada' CHECK (status IN ('criada','rotulo_emitido','postada','cancelada','erro')),
  request jsonb,
  response jsonb,
  nfe_chaves text[] NOT NULL DEFAULT '{}',
  label_path text,
  combined_path text,
  package jsonb,
  price numeric,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  label_generated_at timestamptz,
  cancelled_at timestamptz,
  cancelled_by uuid,
  cancel_reason text,
  error_message text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.correios_shipments TO authenticated;
GRANT ALL ON public.correios_shipments TO service_role;
ALTER TABLE public.correios_shipments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Autenticados leem envios Correios" ON public.correios_shipments FOR SELECT TO authenticated USING (true);
CREATE UNIQUE INDEX correios_shipments_one_active_per_sale ON public.correios_shipments(sale_id) WHERE status NOT IN ('cancelada','erro');
CREATE INDEX correios_shipments_sale_ids_gin ON public.correios_shipments USING gin(sale_ids);
CREATE INDEX IF NOT EXISTS sale_freight_quotes_sale_ids_gin ON public.sale_freight_quotes USING gin(sale_ids);
CREATE TRIGGER trg_correios_shipments_updated BEFORE UPDATE ON public.correios_shipments FOR EACH ROW EXECUTE FUNCTION public._set_updated_at();

CREATE OR REPLACE FUNCTION public.latest_sale_freight_summaries(p_sale_ids uuid[])
RETURNS TABLE(sale_id uuid, quoted_at timestamptz, cheapest jsonb, selected jsonb)
LANGUAGE sql STABLE SET search_path TO 'public'
AS $$
 SELECT requested.id, latest.quoted_at,
   (SELECT o FROM jsonb_array_elements(latest.options) o ORDER BY (o->>'price')::numeric LIMIT 1),
   latest.selected_option
 FROM (SELECT DISTINCT id FROM unnest(p_sale_ids) AS input(id) LIMIT 200) requested
 CROSS JOIN LATERAL (
   SELECT q.quoted_at, q.options, q.selected_option FROM public.sale_freight_quotes q
   WHERE q.sale_ids @> ARRAY[requested.id]
   ORDER BY q.quoted_at DESC, q.id DESC LIMIT 1) latest;
$$;
GRANT EXECUTE ON FUNCTION public.latest_sale_freight_summaries(uuid[]) TO authenticated;