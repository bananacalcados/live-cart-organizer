-- 1) CPF da ficha na criação de venda online/live/link (todos os caminhos), só se vazio.
CREATE OR REPLACE FUNCTION public.pos_sales_fill_cpf_from_customer()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_cpf text;
BEGIN
  IF NULLIF(btrim(COALESCE(NEW.customer_cpf,'')),'') IS NOT NULL OR NEW.customer_id IS NULL THEN RETURN NEW; END IF;
  IF NOT (COALESCE(NEW.sale_type,'') IN ('live','online')
       OR COALESCE(NEW.sales_channel,'') IN ('site','live','link_online','online','whatsapp')
       OR COALESCE(NEW.is_store_pickup,false) OR NEW.source_order_id IS NOT NULL) THEN RETURN NEW; END IF;
  SELECT regexp_replace(COALESCE(c.cpf,''),'\D','','g') INTO v_cpf FROM public.pos_customers c WHERE c.id = NEW.customer_id;
  IF length(v_cpf) = 11 AND v_cpf !~ '^(\d)\1{10}$' THEN NEW.customer_cpf := v_cpf; END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.pos_sales_fill_cpf_from_customer() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_set_pos_sale_cpf_from_customer BEFORE INSERT ON public.pos_sales
  FOR EACH ROW EXECUTE FUNCTION public.pos_sales_fill_cpf_from_customer();

-- 2) Log do preenchimento e lista de pendências para a equipe.
CREATE TABLE public.pos_sales_cpf_backfill_log (
  id bigserial PRIMARY KEY,
  sale_id uuid NOT NULL,
  pos_customer_id uuid,
  cpf_set text NOT NULL,
  matched_from text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.pos_sales_cpf_backfill_log TO service_role;
GRANT SELECT ON public.pos_sales_cpf_backfill_log TO authenticated;
ALTER TABLE public.pos_sales_cpf_backfill_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read cpf backfill log" ON public.pos_sales_cpf_backfill_log FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'manager'));

CREATE TABLE public.pos_sales_cpf_pending (
  sale_id uuid PRIMARY KEY,
  sale_created_at timestamptz,
  customer_name text,
  pos_customer_id uuid,
  reason text NOT NULL CHECK (reason IN ('cpf_divergente','sem_cpf_no_cadastro','sem_cpf_do_pagamento')),
  cadastro_cpf text,
  pagamento_cpfs text[],
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.pos_sales_cpf_pending TO service_role;
GRANT SELECT, UPDATE ON public.pos_sales_cpf_pending TO authenticated;
ALTER TABLE public.pos_sales_cpf_pending ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read cpf pending" ON public.pos_sales_cpf_pending FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'manager'));
CREATE POLICY "admins resolve cpf pending" ON public.pos_sales_cpf_pending FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'manager'))
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'manager'));

-- 3) Uma nota de saída por venda, independente do modelo (devolução finalidade 4 fora).
CREATE OR REPLACE FUNCTION public.claim_fiscal_emission(p_company_id uuid, p_pos_sale_id uuid, p_order_id uuid, p_modelo smallint, p_serie smallint, p_ambiente text, p_valor_total numeric, p_cpf_destinatario text, p_nome_destinatario text, p_company_selection_rule text, p_company_selection_gateway text, p_company_selection_details jsonb)
 RETURNS TABLE(out_document_id uuid, out_numero bigint, out_status text, out_claimed boolean, out_chave_acesso text, out_protocolo text, out_danfe_url text)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_existing public.fiscal_documents%ROWTYPE;
  v_other public.fiscal_documents%ROWTYPE;
  v_document public.fiscal_documents%ROWTYPE;
  v_next bigint;
  v_max_used bigint;
  v_source text;
BEGIN
  IF (p_pos_sale_id IS NULL) = (p_order_id IS NULL) THEN
    RAISE EXCEPTION 'Informe exatamente uma origem fiscal';
  END IF;
  IF p_modelo NOT IN (55, 65) THEN
    RAISE EXCEPTION 'Modelo fiscal inválido';
  END IF;
  IF p_ambiente NOT IN ('homologacao', 'producao') THEN
    RAISE EXCEPTION 'Ambiente fiscal inválido';
  END IF;

  v_source := COALESCE(p_pos_sale_id::text, p_order_id::text);
  PERFORM pg_advisory_xact_lock(hashtextextended('fiscal-emission:' || v_source, 0));

  SELECT * INTO v_existing
  FROM public.fiscal_documents fd
  WHERE ((p_pos_sale_id IS NOT NULL AND fd.pos_sale_id = p_pos_sale_id)
      OR (p_order_id IS NOT NULL AND fd.order_id = p_order_id))
    AND fd.modelo = p_modelo
    AND COALESCE(fd.finalidade, 1) = 1
    AND fd.status IN ('pending', 'pending_sefaz', 'authorized')
  ORDER BY fd.created_at DESC
  LIMIT 1;

  IF FOUND THEN
    RETURN QUERY SELECT v_existing.id, v_existing.numero, v_existing.status, false,
      v_existing.chave_acesso, v_existing.protocolo, v_existing.danfe_url;
    RETURN;
  END IF;

  SELECT * INTO v_other
  FROM public.fiscal_documents fd
  WHERE ((p_pos_sale_id IS NOT NULL AND fd.pos_sale_id = p_pos_sale_id)
      OR (p_order_id IS NOT NULL AND fd.order_id = p_order_id))
    AND fd.modelo <> p_modelo
    AND COALESCE(fd.finalidade, 1) = 1
    AND fd.status IN ('pending', 'pending_sefaz', 'authorized')
  ORDER BY fd.created_at DESC
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'Esta venda já tem nota de saída (modelo %, nº %, %). Não é possível emitir outra nota de saída.',
      v_other.modelo, v_other.numero, v_other.status USING ERRCODE = 'P0001';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('fiscal-seq:' || p_company_id::text || ':' || p_modelo::text || ':' || p_serie::text || ':' || p_ambiente, 0));

  SELECT COALESCE(max(numero), 0) INTO v_max_used
  FROM public.fiscal_documents
  WHERE company_id = p_company_id AND modelo = p_modelo AND serie = p_serie AND ambiente = p_ambiente;

  INSERT INTO public.fiscal_sequences AS fs (company_id, modelo, serie, ambiente, last_number)
  VALUES (p_company_id, p_modelo, p_serie, p_ambiente, v_max_used + 1)
  ON CONFLICT (company_id, modelo, serie, ambiente)
  DO UPDATE SET last_number = GREATEST(fs.last_number, v_max_used) + 1, updated_at = now()
  RETURNING fs.last_number INTO v_next;

  INSERT INTO public.fiscal_documents (
    company_id, pos_sale_id, order_id, modelo, serie, numero, ambiente, status,
    valor_total, cpf_destinatario, nome_destinatario,
    company_selection_rule, company_selection_gateway, company_selection_details
  ) VALUES (
    p_company_id, p_pos_sale_id, p_order_id, p_modelo, p_serie, v_next, p_ambiente, 'pending',
    p_valor_total, p_cpf_destinatario, p_nome_destinatario,
    p_company_selection_rule, p_company_selection_gateway, p_company_selection_details
  ) RETURNING * INTO v_document;

  RETURN QUERY SELECT v_document.id, v_document.numero, v_document.status, true,
    v_document.chave_acesso, v_document.protocolo, v_document.danfe_url;
END;
$function$;

-- 4) Relatório para o contador (somente leitura).
CREATE VIEW public.fiscal_report_online_nfce WITH (security_invoker = on) AS
SELECT s.id AS sale_id, s.created_at AS venda_em, s.sale_type, s.sales_channel AS canal,
  s.customer_name AS cliente, s.customer_cpf AS cpf, s.total AS valor_venda,
  fd.modelo, fd.serie, fd.numero, fd.chave_acesso, fd.valor_total AS valor_nota,
  fd.ambiente, fd.created_at AS nota_em, co.cnpj AS emitente_cnpj, co.legal_name AS emitente
FROM public.fiscal_documents fd
JOIN public.pos_sales s ON s.id = fd.pos_sale_id
LEFT JOIN public.companies co ON co.id = fd.company_id
WHERE fd.modelo = 65 AND fd.status = 'authorized' AND COALESCE(fd.finalidade,1) = 1
  AND (s.sale_type IN ('live','online') OR s.sales_channel IN ('site','live','link_online','online','whatsapp')
       OR COALESCE(s.is_store_pickup,false) OR s.source_order_id IS NOT NULL);

CREATE VIEW public.fiscal_report_double_exit_notes WITH (security_invoker = on) AS
WITH d AS (
  SELECT pos_sale_id FROM public.fiscal_documents
  WHERE pos_sale_id IS NOT NULL AND status = 'authorized' AND COALESCE(finalidade,1) = 1
  GROUP BY pos_sale_id HAVING count(*) > 1
)
SELECT s.id AS sale_id, s.created_at AS venda_em, s.sale_type, s.sales_channel AS canal,
  s.customer_name AS cliente, s.customer_cpf AS cpf, s.total AS valor_venda,
  fd.modelo, fd.serie, fd.numero, fd.chave_acesso, fd.valor_total AS valor_nota,
  fd.ambiente, fd.created_at AS nota_em, co.cnpj AS emitente_cnpj, co.legal_name AS emitente
FROM d JOIN public.pos_sales s ON s.id = d.pos_sale_id
JOIN public.fiscal_documents fd ON fd.pos_sale_id = d.pos_sale_id AND fd.status = 'authorized' AND COALESCE(fd.finalidade,1) = 1
LEFT JOIN public.companies co ON co.id = fd.company_id;

REVOKE ALL ON public.fiscal_report_online_nfce, public.fiscal_report_double_exit_notes FROM PUBLIC, anon;
GRANT SELECT ON public.fiscal_report_online_nfce, public.fiscal_report_double_exit_notes TO authenticated, service_role;