ALTER TABLE public.trocas_devolucoes
  ADD COLUMN IF NOT EXISTS cancelada_em timestamptz,
  ADD COLUMN IF NOT EXISTS cancelada_por uuid,
  ADD COLUMN IF NOT EXISTS motivo_cancelamento_troca text;

CREATE OR REPLACE FUNCTION public.exchange_add_replacement(p_troca_id uuid, p_items jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  t record; o record; it jsonb; p record;
  v_sale uuid; v_total numeric := 0; v_qty int; v_n int := 0;
BEGIN
  IF NOT public._exchange_desk_staff(v_uid) THEN RAISE EXCEPTION 'Sem permissão'; END IF;
  IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 OR jsonb_array_length(p_items) > 10 THEN
    RAISE EXCEPTION 'Informe de 1 a 10 produtos';
  END IF;
  SELECT * INTO t FROM public.trocas_devolucoes WHERE id = p_troca_id FOR UPDATE;
  IF t.id IS NULL THEN RAISE EXCEPTION 'Troca não encontrada'; END IF;
  IF t.tipo::text <> 'troca' THEN RAISE EXCEPTION 'Só trocas recebem produto de troca'; END IF;
  IF t.status::text NOT IN ('iniciada','aguardando_retorno','recebido_conferencia') THEN RAISE EXCEPTION 'Essa troca não está mais aberta'; END IF;
  IF t.pedido_novo_id IS NOT NULL THEN RAISE EXCEPTION 'Essa troca já tem produto na Expedição. Ajuste por "Editar itens" lá.'; END IF;
  SELECT * INTO o FROM public.pos_sales WHERE id = t.pedido_original_id;
  IF o.id IS NULL THEN RAISE EXCEPTION 'Venda original não encontrada'; END IF;

  INSERT INTO public.pos_sales(store_id, stock_source_store_id, seller_id, customer_id, customer_unified_id,
    customer_name, customer_phone, customer_cpf, customer_email, customer_cep, customer_city, customer_state,
    shipping_address, subtotal, discount, total, status, is_conditional, sale_type, expedition_stage, paid_at,
    notes, payment_details)
  VALUES (o.store_id, o.stock_source_store_id, COALESCE(t.vendedora_troca_id, o.seller_id), o.customer_id, o.customer_unified_id,
    o.customer_name, o.customer_phone, o.customer_cpf, o.customer_email, o.customer_cep, o.customer_city, o.customer_state,
    o.shipping_address, 0, 0, 0, 'conditional', false,
    CASE WHEN o.sale_type IN ('live','online') THEN o.sale_type ELSE 'online' END, 'novo', now(),
    '🔁 TROCA ' || COALESCE(t.codigo_devolucao,''),
    jsonb_build_object('link_origin','troca','exchange_replacement',true,'troca_id',t.id))
  RETURNING id INTO v_sale;

  FOR it IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_qty := COALESCE((it->>'quantity')::int, 1);
    IF v_qty < 1 OR v_qty > 10 THEN RAISE EXCEPTION 'Quantidade inválida'; END IF;
    SELECT pp.id, pp.name, pp.sku, pp.barcode, pp.size, pp.variant, pp.price INTO p
      FROM public.pos_products pp JOIN public.pos_stores s ON s.id = pp.store_id
     WHERE s.is_simulation = false
       AND ((NULLIF(it->>'barcode','') IS NOT NULL AND pp.barcode = it->>'barcode')
         OR (NULLIF(it->>'sku','') IS NOT NULL AND pp.sku = it->>'sku'))
     ORDER BY (pp.store_id = COALESCE(o.stock_source_store_id, o.store_id)) DESC, COALESCE(pp.stock,0) DESC LIMIT 1;
    IF p.id IS NULL THEN RAISE EXCEPTION 'Produto não encontrado no cadastro: %', COALESCE(it->>'sku', it->>'barcode'); END IF;
    INSERT INTO public.pos_sale_items(sale_id, sku, barcode, product_name, variant_name, size, quantity, unit_price, total_price)
      VALUES (v_sale, COALESCE(p.sku,''), p.barcode, COALESCE(p.name,'Produto'), p.variant, p.size, v_qty, 0, 0);
    INSERT INTO public.trocas_devolucoes_itens(troca_devolucao_id, direcao, produto_id, sku, barcode, produto_nome, tamanho, quantidade, valor_unitario, repoe_estoque, estado_estoque)
      VALUES (t.id, 'reposicao', p.id, p.sku, p.barcode, p.name, p.size, v_qty, COALESCE(p.price,0), false, 'reservado');
    v_total := v_total + COALESCE(p.price,0) * v_qty; v_n := v_n + 1;
  END LOOP;

  UPDATE public.trocas_devolucoes SET pedido_novo_id = v_sale, valor_reposicao = v_total, updated_at = now() WHERE id = t.id;
  RETURN v_sale;
END $$;

CREATE OR REPLACE FUNCTION public.exchange_cancel(p_troca_id uuid, p_motivo text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); t record;
BEGIN
  IF NOT public._exchange_desk_staff(v_uid) THEN RAISE EXCEPTION 'Sem permissão'; END IF;
  IF length(trim(COALESCE(p_motivo,''))) < 3 THEN RAISE EXCEPTION 'Informe o motivo do cancelamento'; END IF;
  SELECT * INTO t FROM public.trocas_devolucoes WHERE id = p_troca_id FOR UPDATE;
  IF t.id IS NULL THEN RAISE EXCEPTION 'Troca não encontrada'; END IF;
  IF t.status::text IN ('concluida','cancelada') THEN RAISE EXCEPTION 'Essa troca já foi encerrada'; END IF;
  IF t.status::text = 'aguardando_envio' THEN RAISE EXCEPTION 'Troca já finalizada no PDV; não pode ser cancelada aqui'; END IF;
  IF t.voucher_id IS NOT NULL OR t.gateway_refund_id IS NOT NULL THEN RAISE EXCEPTION 'Troca com voucher/estorno gerado não pode ser cancelada'; END IF;
  IF t.pedido_novo_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.pos_sales WHERE id = t.pedido_novo_id AND (shipped_at IS NOT NULL OR expedition_stage = 'concluido')) THEN
    RAISE EXCEPTION 'O produto da troca já foi enviado';
  END IF;

  UPDATE public.trocas_devolucoes SET status = 'cancelada', cancelada_em = now(), cancelada_por = v_uid,
    motivo_cancelamento_troca = trim(p_motivo), updated_at = now() WHERE id = t.id;
  IF t.pedido_novo_id IS NOT NULL THEN
    UPDATE public.pos_sales SET status = 'cancelled', expedition_deleted_at = now(), expedition_deleted_by = v_uid,
      notes = COALESCE(notes,'') || ' · troca cancelada: ' || trim(p_motivo)
     WHERE id = t.pedido_novo_id AND status <> 'cancelled';
    UPDATE public.trocas_devolucoes_itens SET estado_estoque = NULL, updated_at = now()
     WHERE troca_devolucao_id = t.id AND direcao = 'reposicao';
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.exchange_add_replacement(uuid, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.exchange_cancel(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.exchange_add_replacement(uuid, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.exchange_cancel(uuid, text) TO authenticated, service_role;