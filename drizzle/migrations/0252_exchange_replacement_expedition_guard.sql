CREATE OR REPLACE FUNCTION public.guard_exchange_replacement_sale()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id uuid := COALESCE(NEW.id, OLD.id);
  td record;
BEGIN
  SELECT t.id, t.codigo_devolucao, t.status::text AS status, t.modo_expedicao::text AS modo
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

  IF td.modo = 'aguarda_retorno' AND td.status IN ('iniciada','aguardando_retorno','recebido_conferencia')
     AND ((OLD.expedition_stage IS DISTINCT FROM NEW.expedition_stage AND NEW.expedition_stage = 'concluido')
          OR (OLD.shipped_at IS NULL AND NEW.shipped_at IS NOT NULL)) THEN
    RAISE EXCEPTION 'TROCA_LOCK: aguardando finalizar a troca % no PDV antes de concluir o envio.', td.codigo_devolucao
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;

REVOKE EXECUTE ON FUNCTION public.guard_exchange_replacement_sale() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_pos_sales_exchange_lock_upd
BEFORE UPDATE ON public.pos_sales
FOR EACH ROW
WHEN (OLD.expedition_stage IS DISTINCT FROM NEW.expedition_stage
   OR OLD.expedition_deleted_at IS DISTINCT FROM NEW.expedition_deleted_at
   OR OLD.shipped_at IS DISTINCT FROM NEW.shipped_at
   OR OLD.status IS DISTINCT FROM NEW.status
   OR OLD.status_cancelamento IS DISTINCT FROM NEW.status_cancelamento)
EXECUTE FUNCTION public.guard_exchange_replacement_sale();

CREATE TRIGGER trg_pos_sales_exchange_lock_del
BEFORE DELETE ON public.pos_sales
FOR EACH ROW EXECUTE FUNCTION public.guard_exchange_replacement_sale();