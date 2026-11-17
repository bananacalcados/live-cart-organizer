CREATE OR REPLACE FUNCTION public.guard_exchange_replacement_sale()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
    IF td.status = 'aguardando_envio' AND NEW.expedition_stage = 'concluido' THEN
      UPDATE public.trocas_devolucoes SET status = 'concluida', updated_at = now()
       WHERE id = td.id AND status::text = 'aguardando_envio';
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.guard_exchange_replacement_sale() FROM PUBLIC, anon, authenticated;