CREATE UNIQUE INDEX IF NOT EXISTS fiscal_documents_one_pending_sale_emission
ON public.fiscal_documents (pos_sale_id, modelo)
WHERE pos_sale_id IS NOT NULL
  AND status IN ('pending', 'pending_sefaz')
  AND COALESCE(finalidade, 1) = 1;

CREATE UNIQUE INDEX IF NOT EXISTS fiscal_documents_one_pending_order_emission
ON public.fiscal_documents (order_id, modelo)
WHERE order_id IS NOT NULL
  AND status IN ('pending', 'pending_sefaz')
  AND COALESCE(finalidade, 1) = 1;

CREATE OR REPLACE FUNCTION public.claim_fiscal_emission(
  p_company_id uuid,
  p_pos_sale_id uuid,
  p_order_id uuid,
  p_modelo smallint,
  p_serie smallint,
  p_ambiente text,
  p_valor_total numeric,
  p_cpf_destinatario text,
  p_nome_destinatario text,
  p_company_selection_rule text,
  p_company_selection_gateway text,
  p_company_selection_details jsonb
)
RETURNS TABLE(
  out_document_id uuid,
  out_numero bigint,
  out_status text,
  out_claimed boolean,
  out_chave_acesso text,
  out_protocolo text,
  out_danfe_url text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing public.fiscal_documents%ROWTYPE;
  v_document public.fiscal_documents%ROWTYPE;
  v_next bigint;
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
  PERFORM pg_advisory_xact_lock(hashtextextended('fiscal-emission:' || v_source || ':' || p_modelo::text, 0));

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

  INSERT INTO public.fiscal_sequences AS fs (company_id, modelo, serie, ambiente, last_number)
  VALUES (p_company_id, p_modelo, p_serie, p_ambiente, 1)
  ON CONFLICT (company_id, modelo, serie, ambiente)
  DO UPDATE SET last_number = fs.last_number + 1, updated_at = now()
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
$$;

REVOKE ALL ON FUNCTION public.claim_fiscal_emission(uuid, uuid, uuid, smallint, smallint, text, numeric, text, text, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_fiscal_emission(uuid, uuid, uuid, smallint, smallint, text, numeric, text, text, text, text, jsonb) TO service_role;

COMMENT ON FUNCTION public.claim_fiscal_emission(uuid, uuid, uuid, smallint, smallint, text, numeric, text, text, text, text, jsonb) IS 'Service-only: reutiliza emissão ativa/autorizada ou reserva atomicamente número e documento pendente por origem e modelo.';