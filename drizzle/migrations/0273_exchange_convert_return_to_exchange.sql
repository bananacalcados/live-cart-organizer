CREATE OR REPLACE FUNCTION public.exchange_convert_return_to_exchange(p_troca_id uuid, p_motivo text DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid(); t record; v_nome text;
BEGIN
  IF NOT public._exchange_desk_staff(v_uid) THEN RAISE EXCEPTION 'Sem permissão'; END IF;
  SELECT * INTO t FROM public.trocas_devolucoes WHERE id = p_troca_id FOR UPDATE;
  IF t.id IS NULL THEN RAISE EXCEPTION 'Devolução não encontrada'; END IF;
  IF t.tipo::text <> 'devolucao' THEN RAISE EXCEPTION 'Este registro já é uma troca'; END IF;
  IF t.status::text NOT IN ('iniciada','aguardando_retorno','recebido_conferencia') THEN RAISE EXCEPTION 'Essa devolução já foi encerrada'; END IF;
  IF t.voucher_id IS NOT NULL OR t.gateway_refund_id IS NOT NULL THEN RAISE EXCEPTION 'Devolução com voucher/estorno gerado não pode virar troca'; END IF;
  IF EXISTS (SELECT 1 FROM public.gateway_refunds g WHERE g.pos_sale_id = t.pedido_original_id AND g.status NOT IN ('rejected','cancelled','failed')) THEN
    RAISE EXCEPTION 'Já existe estorno pedido para esta venda; resolva antes de converter';
  END IF;
  SELECT COALESCE(NULLIF(raw_user_meta_data->>'full_name',''), email) INTO v_nome FROM auth.users WHERE id = v_uid;
  UPDATE public.trocas_devolucoes SET tipo = 'troca', estorno_forma = NULL, resolucao_diferenca = NULL,
    historico_reposicao = COALESCE(historico_reposicao,'[]'::jsonb) || jsonb_build_array(jsonb_build_object(
      'evento','convertida_de_devolucao_para_troca','em',now(),'por_id',v_uid,'por',v_nome,
      'observacao',NULLIF(trim(COALESCE(p_motivo,'')),''),'codigo_reversa_anterior',t.codigo_postagem_reversa,
      'nota_devolucao_mantida',t.devolucao_doc_id)),
    updated_at = now()
   WHERE id = t.id;
  UPDATE public.pos_sales SET motivo_cancelamento = 'troca'
   WHERE id = t.pedido_original_id AND motivo_cancelamento::text = 'devolucao';
  RETURN jsonb_build_object('codigo', t.codigo_devolucao, 'nota_mantida', t.devolucao_doc_id IS NOT NULL);
END $function$;
REVOKE ALL ON FUNCTION public.exchange_convert_return_to_exchange(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.exchange_convert_return_to_exchange(uuid, text) TO authenticated, service_role;