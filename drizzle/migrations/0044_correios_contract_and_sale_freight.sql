CREATE TABLE public.correios_settings (
 id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1), usuario text NOT NULL DEFAULT '', codigo_acesso text NOT NULL DEFAULT '', cartao_postagem text NOT NULL DEFAULT '', contrato text, ambiente text NOT NULL DEFAULT 'producao' CHECK (ambiente IN ('producao','homologacao')), enabled boolean NOT NULL DEFAULT false,
 remetente jsonb NOT NULL DEFAULT '{"nome":"Banana Calçados Pérola","cnpj":"26586173000127","telefone":"33991230581","email":"","cep":"35051520","logradouro":"Rua Vale Formoso","numero":"362","complemento":"","bairro":"Kennedy","cidade":"Governador Valadares","uf":"MG"}'::jsonb,
 servicos jsonb NOT NULL DEFAULT '[{"codigo":"03220","nome":"SEDEX","ativo":true},{"codigo":"03298","nome":"PAC","ativo":true}]'::jsonb,
 token text, token_expira_em timestamptz, token_meta jsonb, updated_by uuid, updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.correios_settings TO service_role;
REVOKE ALL ON public.correios_settings FROM anon, authenticated;
ALTER TABLE public.correios_settings ENABLE ROW LEVEL SECURITY;
CREATE TABLE public.sale_freight_quotes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), sale_id uuid NOT NULL REFERENCES public.pos_sales(id), sale_ids uuid[] NOT NULL, package jsonb NOT NULL, options jsonb NOT NULL DEFAULT '[]'::jsonb, errors jsonb NOT NULL DEFAULT '{}'::jsonb, quoted_by uuid NOT NULL, quoted_at timestamptz NOT NULL DEFAULT now(), selected_option jsonb, context jsonb NOT NULL DEFAULT '{}'::jsonb
);
GRANT SELECT ON public.sale_freight_quotes TO authenticated;
GRANT ALL ON public.sale_freight_quotes TO service_role;
ALTER TABLE public.sale_freight_quotes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated freight quote reads" ON public.sale_freight_quotes FOR SELECT TO authenticated USING (true);
CREATE INDEX sale_freight_quotes_sale_date_idx ON public.sale_freight_quotes(sale_id, quoted_at DESC, id DESC);
CREATE FUNCTION public.select_sale_freight_option(p_quote_id uuid, p_option_index integer, p_user_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE q public.sale_freight_quotes; opt jsonb; carrier_name text; carrier_type text; sales_count integer;
BEGIN
 SELECT * INTO q FROM public.sale_freight_quotes WHERE id = p_quote_id FOR UPDATE;
 IF q.id IS NULL OR p_option_index < 0 OR p_option_index >= jsonb_array_length(q.options) THEN RAISE EXCEPTION 'Cotação ou opção inválida'; END IF;
 IF NOT (public.has_role(p_user_id,'admin') OR public.has_module_access(p_user_id,'pos') OR public.has_module_access(p_user_id,'expedition')) THEN RAISE EXCEPTION 'Sem permissão para cotar fretes'; END IF;
 PERFORM id FROM public.pos_sales WHERE id = ANY(q.sale_ids) ORDER BY id FOR UPDATE;
 SELECT count(*) INTO sales_count FROM public.pos_sales s WHERE s.id = ANY(q.sale_ids) AND s.expedition_stage = 'conferencia' AND NOT coalesce(s.is_store_pickup,false) AND coalesce(s.shipping_type,'') NOT IN ('mototaxi','retirada') AND coalesce(s.expedition_group_id::text,'') = coalesce(q.context->>'group_id','') AND s.shipping_address IS NOT DISTINCT FROM q.context->'address';
 IF sales_count <> cardinality(q.sale_ids) THEN RAISE EXCEPTION 'Pedido/endereço/agrupamento mudou. Abra a Conferência e recote os fretes'; END IF;
 IF EXISTS (SELECT 1 FROM public.sale_freight_quotes newer WHERE newer.sale_id=q.sale_id AND (newer.quoted_at,newer.id) > (q.quoted_at,q.id)) THEN RAISE EXCEPTION 'Há uma cotação mais recente. Recarregue'; END IF;
 IF q.context->'items' IS DISTINCT FROM (SELECT jsonb_agg(jsonb_build_object('id',i.id,'quantity',i.expedition_conference_qty,'sku',i.sku,'barcode',i.barcode) ORDER BY i.id) FROM public.pos_sale_items i WHERE i.sale_id=ANY(q.sale_ids) AND i.expedition_conference_qty > 0) THEN RAISE EXCEPTION 'Itens da Conferência mudaram. Recote os fretes'; END IF;
 opt := q.options->p_option_index; carrier_name := opt->>'shipping_carrier'; carrier_type := opt->>'shipping_type';
 IF carrier_name IS NULL OR carrier_type NOT IN ('correios','transportadora') THEN RAISE EXCEPTION 'Opção inválida'; END IF;
 UPDATE public.sale_freight_quotes SET selected_option=opt WHERE id=q.id AND selected_option IS DISTINCT FROM opt;
 UPDATE public.pos_sales SET shipping_carrier=carrier_name, shipping_type=carrier_type WHERE id=ANY(q.sale_ids) AND (shipping_carrier IS DISTINCT FROM carrier_name OR shipping_type IS DISTINCT FROM carrier_type);
 RETURN opt;
END $$;
REVOKE ALL ON FUNCTION public.select_sale_freight_option(uuid,integer,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.select_sale_freight_option(uuid,integer,uuid) TO service_role;