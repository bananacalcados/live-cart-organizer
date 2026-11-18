CREATE OR REPLACE FUNCTION public.exchange_swap_replacement(p_troca_id uuid, p_items jsonb, p_motivo text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_uid uuid := auth.uid(); t record; d record; v_old jsonb; v_new uuid;
BEGIN
  IF NOT public._exchange_desk_staff(v_uid) THEN RAISE EXCEPTION 'Sem permissão'; END IF;
  IF length(trim(COALESCE(p_motivo,''))) < 3 THEN RAISE EXCEPTION 'Informe o motivo da troca de produto'; END IF;
  SELECT * INTO t FROM public.trocas_devolucoes WHERE id = p_troca_id FOR UPDATE;
  IF t.id IS NULL THEN RAISE EXCEPTION 'Troca não encontrada'; END IF;
  IF t.tipo::text <> 'troca' THEN RAISE EXCEPTION 'Só trocas têm produto de troca'; END IF;
  IF t.status::text NOT IN ('iniciada','aguardando_retorno','recebido_conferencia') THEN RAISE EXCEPTION 'Essa troca já foi finalizada ou encerrada; não dá mais para trocar o produto'; END IF;
  IF t.pedido_novo_id IS NULL THEN RAISE EXCEPTION 'Essa troca ainda não tem produto; use Adicionar produto'; END IF;
  IF t.voucher_id IS NOT NULL OR t.gateway_refund_id IS NOT NULL THEN RAISE EXCEPTION 'Troca com voucher/estorno gerado não pode trocar o produto'; END IF;
  IF EXISTS (SELECT 1 FROM public.pos_sales WHERE id = t.pedido_novo_id AND (shipped_at IS NOT NULL OR expedition_stage = 'concluido')) THEN
    RAISE EXCEPTION 'O produto da troca já foi enviado';
  END IF;
  IF EXISTS (SELECT 1 FROM public.fiscal_documents WHERE pos_sale_id = t.pedido_novo_id AND COALESCE(status,'') NOT IN ('cancelada','cancelado','rejeitada','erro','denegada')) THEN
    RAISE EXCEPTION 'O produto da troca já tem nota emitida';
  END IF;
  IF t.diferenca_venda_id IS NOT NULL THEN
    SELECT id, status INTO d FROM public.pos_sales WHERE id = t.diferenca_venda_id FOR UPDATE;
    IF d.id IS NOT NULL AND d.status NOT IN ('online_pending','pending','payment_failed','cancelled') THEN
      RAISE EXCEPTION 'A diferença já foi paga; não dá para trocar o produto aqui';
    END IF;
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('sku',sku,'produto_nome',produto_nome,'tamanho',tamanho,'quantidade',quantidade,'valor_unitario',valor_unitario)),'[]'::jsonb)
    INTO v_old FROM public.trocas_devolucoes_itens WHERE troca_devolucao_id = t.id AND direcao = 'reposicao';

  UPDATE public.trocas_devolucoes SET
    historico_reposicao = COALESCE(historico_reposicao,'[]'::jsonb) || jsonb_build_array(jsonb_build_object(
      'em', now(), 'por', v_uid, 'motivo', trim(p_motivo), 'pedido_antigo', t.pedido_novo_id,
      'link_diferenca_cancelado', CASE WHEN d.id IS NOT NULL AND d.status <> 'cancelled' THEN d.id END, 'itens_antigos', v_old)),
    pedido_novo_id = NULL, diferenca_venda_id = NULL, valor_reposicao = 0, updated_at = now()
   WHERE id = t.id;
  DELETE FROM public.trocas_devolucoes_itens WHERE troca_devolucao_id = t.id AND direcao = 'reposicao';

  IF d.id IS NOT NULL AND d.status <> 'cancelled' THEN
    UPDATE public.pos_sales SET status = 'cancelled', notes = COALESCE(notes,'') || ' · produto da troca substituído' WHERE id = d.id;
  END IF;
  UPDATE public.pos_sales SET status = 'cancelled', expedition_deleted_at = now(), expedition_deleted_by = v_uid,
    notes = COALESCE(notes,'') || ' · produto da troca substituído: ' || trim(p_motivo)
   WHERE id = t.pedido_novo_id AND status <> 'cancelled';

  v_new := public.exchange_add_replacement(p_troca_id, p_items);
  RETURN v_new;
END $function$;

REVOKE ALL ON FUNCTION public.exchange_swap_replacement(uuid, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.exchange_swap_replacement(uuid, jsonb, text) TO authenticated, service_role;