ALTER TABLE public.trocas_devolucoes ADD COLUMN IF NOT EXISTS diferenca_venda_id uuid;

CREATE OR REPLACE FUNCTION public.exchange_create_difference_link(p_troca_id uuid, p_frete numeric, p_frete_modo text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid(); t record; o record; d record;
  v_dev numeric; v_rep numeric; v_diff numeric; v_frete numeric := round(COALESCE(p_frete,0),2); v_prod numeric; v_sale uuid;
BEGIN
  IF NOT public._exchange_desk_staff(v_uid) THEN RAISE EXCEPTION 'Sem permissão'; END IF;
  IF p_frete_modo NOT IN ('gratis','cotado','fixo') THEN RAISE EXCEPTION 'Modo de frete inválido'; END IF;
  IF p_frete_modo = 'gratis' THEN v_frete := 0; END IF;
  IF v_frete < 0 OR v_frete > 500 THEN RAISE EXCEPTION 'Frete inválido'; END IF;
  SELECT * INTO t FROM public.trocas_devolucoes WHERE id = p_troca_id FOR UPDATE;
  IF t.id IS NULL OR t.tipo::text <> 'troca' THEN RAISE EXCEPTION 'Troca não encontrada'; END IF;
  IF t.status::text NOT IN ('iniciada','aguardando_retorno','recebido_conferencia') THEN RAISE EXCEPTION 'Essa troca não está mais aberta'; END IF;
  IF t.pedido_novo_id IS NULL THEN RAISE EXCEPTION 'Adicione primeiro o produto da troca'; END IF;

  IF t.diferenca_venda_id IS NOT NULL THEN
    SELECT id, status, paid_at INTO d FROM public.pos_sales WHERE id = t.diferenca_venda_id FOR UPDATE;
    IF d.id IS NOT NULL AND d.status NOT IN ('online_pending','pending','payment_failed','cancelled') THEN
      RAISE EXCEPTION 'A diferença dessa troca já foi paga';
    END IF;
    IF d.id IS NOT NULL AND d.status <> 'cancelled' THEN
      UPDATE public.pos_sales SET status = 'cancelled', notes = COALESCE(notes,'') || ' · substituído por novo link da diferença' WHERE id = d.id;
    END IF;
  END IF;

  SELECT COALESCE(sum(valor_unitario * COALESCE(quantidade,1)) FILTER (WHERE direcao='devolvido'),0),
         COALESCE(sum(valor_unitario * COALESCE(quantidade,1)) FILTER (WHERE direcao='reposicao'),0)
    INTO v_dev, v_rep FROM public.trocas_devolucoes_itens WHERE troca_devolucao_id = t.id;
  v_diff := round(v_rep - v_dev, 2);
  v_prod := GREATEST(v_diff, 0);
  IF v_prod + v_frete < 0.01 THEN RAISE EXCEPTION 'Não há valor a cobrar nessa troca'; END IF;

  SELECT * INTO o FROM public.pos_sales WHERE id = t.pedido_original_id;
  INSERT INTO public.pos_sales(store_id, stock_source_store_id, seller_id, customer_id, customer_unified_id,
    customer_name, customer_phone, customer_cpf, customer_email, customer_cep, customer_city, customer_state,
    shipping_address, subtotal, discount, total, shipping_cost, status, sale_type, expedition_stage,
    payment_gateway, notes, payment_details)
  VALUES (o.store_id, o.store_id, COALESCE(t.vendedora_troca_id, o.seller_id), o.customer_id, o.customer_unified_id,
    o.customer_name, o.customer_phone, o.customer_cpf, o.customer_email, o.customer_cep, o.customer_city, o.customer_state,
    o.shipping_address, v_prod, 0, v_prod + v_frete, v_frete, 'online_pending', 'online', 'nao_aplica',
    'store-checkout', '🔁 Diferença da troca ' || COALESCE(t.codigo_devolucao,''),
    jsonb_build_object('link_origin','troca_diferenca','is_custom_amount',true,'troca_id',t.id,
      'frete_troca',v_frete,'frete_modo',p_frete_modo,'description','Diferença da troca',
      'customer_name',o.customer_name,'customer_phone',o.customer_phone,'customer_cpf',o.customer_cpf,'customer_email',o.customer_email))
  RETURNING id INTO v_sale;
  IF v_prod > 0 THEN
    INSERT INTO public.pos_sale_items(sale_id, sku, product_name, quantity, unit_price, total_price)
      VALUES (v_sale, '', 'Diferença da troca ' || COALESCE(t.codigo_devolucao,''), 1, v_prod, v_prod);
  END IF;
  IF v_frete > 0 THEN
    INSERT INTO public.pos_sale_items(sale_id, sku, product_name, quantity, unit_price, total_price)
      VALUES (v_sale, '', 'Frete do novo envio', 1, v_frete, v_frete);
  END IF;
  UPDATE public.trocas_devolucoes SET diferenca_venda_id = v_sale, valor_devolvido = v_dev, valor_reposicao = v_rep,
    diferenca = v_diff, updated_at = now() WHERE id = t.id;
  RETURN jsonb_build_object('sale_id', v_sale, 'store_id', o.store_id, 'total', v_prod + v_frete, 'diferenca', v_diff, 'frete', v_frete);
END $$;
REVOKE ALL ON FUNCTION public.exchange_create_difference_link(uuid, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.exchange_create_difference_link(uuid, numeric, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.exchange_cancel(p_troca_id uuid, p_motivo text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); t record; d record;
BEGIN
  IF NOT public._exchange_desk_staff(v_uid) THEN RAISE EXCEPTION 'Sem permissão'; END IF;
  IF length(trim(COALESCE(p_motivo,''))) < 3 THEN RAISE EXCEPTION 'Informe o motivo do cancelamento'; END IF;
  SELECT * INTO t FROM public.trocas_devolucoes WHERE id = p_troca_id FOR UPDATE;
  IF t.id IS NULL THEN RAISE EXCEPTION 'Troca não encontrada'; END IF;
  IF t.status::text IN ('concluida','cancelada') THEN RAISE EXCEPTION 'Essa troca já foi encerrada'; END IF;
  IF t.status::text = 'aguardando_envio' THEN RAISE EXCEPTION 'Troca já finalizada no PDV; não pode ser cancelada aqui'; END IF;
  IF t.voucher_id IS NOT NULL OR t.gateway_refund_id IS NOT NULL THEN RAISE EXCEPTION 'Troca com voucher/estorno gerado não pode ser cancelada'; END IF;
  IF t.diferenca_venda_id IS NOT NULL THEN
    SELECT id, status INTO d FROM public.pos_sales WHERE id = t.diferenca_venda_id FOR UPDATE;
    IF d.id IS NOT NULL AND d.status NOT IN ('online_pending','pending','payment_failed','cancelled') THEN
      RAISE EXCEPTION 'A diferença já foi paga; essa troca não pode ser cancelada aqui';
    END IF;
  END IF;
  IF t.pedido_novo_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.pos_sales WHERE id = t.pedido_novo_id AND (shipped_at IS NOT NULL OR expedition_stage = 'concluido')) THEN
    RAISE EXCEPTION 'O produto da troca já foi enviado';
  END IF;

  UPDATE public.trocas_devolucoes SET status = 'cancelada', cancelada_em = now(), cancelada_por = v_uid,
    motivo_cancelamento_troca = trim(p_motivo), updated_at = now() WHERE id = t.id;
  IF d.id IS NOT NULL AND d.status <> 'cancelled' THEN
    UPDATE public.pos_sales SET status = 'cancelled', notes = COALESCE(notes,'') || ' · troca cancelada' WHERE id = d.id;
  END IF;
  IF t.pedido_novo_id IS NOT NULL THEN
    UPDATE public.pos_sales SET status = 'cancelled', expedition_deleted_at = now(), expedition_deleted_by = v_uid,
      notes = COALESCE(notes,'') || ' · troca cancelada: ' || trim(p_motivo)
     WHERE id = t.pedido_novo_id AND status <> 'cancelled';
    UPDATE public.trocas_devolucoes_itens SET estado_estoque = NULL, updated_at = now()
     WHERE troca_devolucao_id = t.id AND direcao = 'reposicao';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.guard_exchange_replacement_sale()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_id uuid := COALESCE(NEW.id, OLD.id);
  td record;
BEGIN
  SELECT t.id, t.codigo_devolucao, t.status::text AS status, t.modo_expedicao::text AS modo, t.diferenca_venda_id
    INTO td
    FROM public.trocas_devolucoes t
   WHERE t.pedido_novo_id = v_id AND t.status::text NOT IN ('cancelada','concluida')
   ORDER BY t.created_at DESC LIMIT 1;
  IF td.id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'DELETE'
     OR (OLD.expedition_deleted_at IS NULL AND NEW.expedition_deleted_at IS NOT NULL)
     OR (OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'cancelled')
     OR (OLD.status_cancelamento IS DISTINCT FROM NEW.status_cancelamento AND NEW.status_cancelamento::text = 'cancelado') THEN
    RAISE EXCEPTION 'TROCA_LOCK: produto da troca % não pode ser excluído da Expedição. Cancele a troca primeiro.', td.codigo_devolucao
      USING ERRCODE = 'P0001';
  END IF;

  IF (OLD.expedition_stage IS DISTINCT FROM NEW.expedition_stage AND NEW.expedition_stage = 'concluido')
     OR (OLD.shipped_at IS NULL AND NEW.shipped_at IS NOT NULL) THEN
    IF td.modo = 'aguarda_retorno' AND td.status IN ('iniciada','aguardando_retorno','recebido_conferencia') THEN
      RAISE EXCEPTION 'TROCA_LOCK: aguardando finalizar a troca % no PDV antes de concluir o envio.', td.codigo_devolucao
        USING ERRCODE = 'P0001';
    END IF;
    IF td.diferenca_venda_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.pos_sales s WHERE s.id = td.diferenca_venda_id
         AND s.status IN ('online_pending','pending','payment_failed')) THEN
      RAISE EXCEPTION 'TROCA_LOCK: a diferença da troca % ainda não foi paga.', td.codigo_devolucao
        USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END $$;