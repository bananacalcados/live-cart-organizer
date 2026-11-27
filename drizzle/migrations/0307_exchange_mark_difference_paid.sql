CREATE OR REPLACE FUNCTION public.exchange_mark_difference_paid(
  p_troca_id uuid,
  p_method text,
  p_pix_key text DEFAULT NULL,
  p_installments integer DEFAULT 1
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  t record;
  d record;
  v_method text := trim(COALESCE(p_method, ''));
  v_pix_key text := NULLIF(trim(COALESCE(p_pix_key, '')), '');
  v_installments integer := COALESCE(p_installments, 1);
  v_label text;
  v_dev numeric;
  v_rep numeric;
  v_diff numeric;
  v_frete numeric;
  v_expected numeric;
  v_now timestamptz := now();
  v_allowed text[] := ARRAY[
    'PIX', 'Dinheiro', 'Cartão de Débito', 'Cartão de Crédito à vista',
    'Cartão de Crédito parcelado', 'VPS', 'Boleto', 'Crediário', 'Cashback',
    'Vale-troca', 'Cheque', 'Transferência / TED', 'Link de pagamento'
  ];
BEGIN
  IF NOT public._exchange_desk_staff(v_uid) THEN
    RAISE EXCEPTION 'Sem permissão';
  END IF;
  IF NOT v_method = ANY(v_allowed) THEN
    RAISE EXCEPTION 'Forma de pagamento inválida';
  END IF;
  IF v_method = 'PIX' AND v_pix_key IS NULL THEN
    RAISE EXCEPTION 'Informe em qual chave PIX o pagamento caiu';
  END IF;
  IF v_method IN ('Cartão de Crédito parcelado', 'Crediário') THEN
    IF v_installments < 2 OR v_installments > 6 THEN
      RAISE EXCEPTION 'Escolha de 2 a 6 parcelas';
    END IF;
    v_label := v_method || ' ' || v_installments || 'x';
  ELSE
    v_installments := 1;
    v_label := v_method;
  END IF;

  SELECT * INTO t FROM public.trocas_devolucoes WHERE id = p_troca_id FOR UPDATE;
  IF t.id IS NULL OR t.tipo::text <> 'troca' THEN
    RAISE EXCEPTION 'Troca não encontrada';
  END IF;
  IF t.status::text NOT IN ('iniciada', 'aguardando_retorno', 'recebido_conferencia') THEN
    RAISE EXCEPTION 'Essa troca não está mais aberta';
  END IF;
  IF t.diferenca_venda_id IS NULL THEN
    RAISE EXCEPTION 'Gere primeiro o link da diferença para conferir o valor recebido';
  END IF;

  SELECT * INTO d FROM public.pos_sales WHERE id = t.diferenca_venda_id FOR UPDATE;
  IF d.id IS NULL OR COALESCE(d.payment_details->>'link_origin', '') <> 'troca_diferenca' THEN
    RAISE EXCEPTION 'Cobrança da diferença não encontrada';
  END IF;
  IF d.status IN ('paid', 'completed') THEN
    RETURN jsonb_build_object('ok', true, 'already_paid', true, 'sale_id', d.id, 'total', d.total, 'status', d.status);
  END IF;
  IF d.status NOT IN ('online_pending', 'pending', 'payment_failed') THEN
    RAISE EXCEPTION 'Esse link não está mais aguardando pagamento';
  END IF;

  SELECT
    COALESCE(sum(valor_unitario * COALESCE(quantidade, 1)) FILTER (WHERE direcao = 'devolvido'), 0),
    COALESCE(sum(valor_unitario * COALESCE(quantidade, 1)) FILTER (WHERE direcao = 'reposicao'), 0)
  INTO v_dev, v_rep
  FROM public.trocas_devolucoes_itens
  WHERE troca_devolucao_id = t.id;

  v_diff := round(v_rep - v_dev, 2);
  v_frete := COALESCE((d.payment_details->>'frete_troca')::numeric, d.shipping_cost, 0);
  v_expected := round(GREATEST(v_diff, 0) + v_frete, 2);
  IF v_expected < 0.01 OR abs(COALESCE(d.total, 0) - v_expected) > 0.01 THEN
    RAISE EXCEPTION 'O valor da troca mudou. Gere um novo link antes de confirmar o pagamento.';
  END IF;

  UPDATE public.pos_sales
  SET status = 'paid',
      paid_at = v_now,
      payment_method = v_label,
      payment_method_detail = 'manual_external',
      payment_gateway = 'manual',
      payment_details = COALESCE(d.payment_details, '{}'::jsonb) || jsonb_build_object(
        'manual_payment', jsonb_build_object(
          'method', v_label,
          'pix_key', CASE WHEN v_method = 'PIX' THEN v_pix_key ELSE NULL END,
          'installments', v_installments,
          'confirmed_at', v_now,
          'confirmed_by', v_uid,
          'external', true
        )
      ),
      notes = COALESCE(d.notes, '') || E'\n✅ Diferença confirmada manualmente (' || v_label || ')',
      updated_at = v_now
  WHERE id = d.id;

  DELETE FROM public.chat_awaiting_payment WHERE sale_id = d.id;
  UPDATE public.chat_payment_followups
  SET is_active = false, completed_at = v_now
  WHERE sale_id = d.id AND is_active = true;

  RETURN jsonb_build_object('ok', true, 'already_paid', false, 'sale_id', d.id, 'total', d.total, 'status', 'paid', 'method', v_label);
END
$function$;

REVOKE ALL ON FUNCTION public.exchange_mark_difference_paid(uuid, text, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.exchange_mark_difference_paid(uuid, text, text, integer) TO authenticated, service_role;