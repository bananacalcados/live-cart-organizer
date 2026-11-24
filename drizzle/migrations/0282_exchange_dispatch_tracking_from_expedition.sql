CREATE OR REPLACE FUNCTION public.guard_exchange_replacement_sale()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid := COALESCE(NEW.id, OLD.id);
  td record;
  v_tid uuid;
  v_code text;
  v_carrier text;
BEGIN
  -- Rastreio/envio do par novo: copia para a troca ligada (pedido_novo_id ou venda-espelho da troca).
  IF TG_OP = 'UPDATE' AND (
       (coalesce(NEW.tracking_code,'') <> '' AND OLD.tracking_code IS DISTINCT FROM NEW.tracking_code)
    OR (OLD.shipped_at IS NULL AND NEW.shipped_at IS NOT NULL)) THEN
    v_code := nullif(trim(coalesce(NEW.tracking_code,'')),'');
    v_carrier := nullif(trim(coalesce(NEW.tracking_carrier, NEW.shipping_carrier, '')),'');
    SELECT t.id INTO v_tid FROM public.trocas_devolucoes t
     WHERE t.tipo::text='troca' AND t.status::text NOT IN ('cancelada')
       AND (t.pedido_novo_id = NEW.id
            OR (NEW.external_source = 'troca' AND t.id::text = NEW.external_order_id))
     ORDER BY t.created_at DESC LIMIT 1;
    IF v_tid IS NOT NULL THEN
      UPDATE public.trocas_devolucoes SET
        tracking_code = coalesce(v_code, tracking_code),
        tracking_carrier = coalesce(v_carrier, tracking_carrier),
        despachada_em = coalesce(despachada_em, NEW.shipped_at, now()),
        status = CASE WHEN status::text='aguardando_envio' THEN 'concluida'::td_status ELSE status END,
        updated_at = now()
      WHERE id = v_tid
        AND status::text IN ('aguardando_envio','concluida')
        AND (tracking_code IS DISTINCT FROM coalesce(v_code, tracking_code)
          OR tracking_carrier IS DISTINCT FROM coalesce(v_carrier, tracking_carrier)
          OR despachada_em IS NULL OR status::text='aguardando_envio');
    END IF;
  END IF;

  SELECT t.id, t.codigo_devolucao, t.status::text AS status, t.modo_expedicao::text AS modo, t.diferenca_venda_id
    INTO td FROM public.trocas_devolucoes t
   WHERE t.pedido_novo_id = v_id AND t.status::text NOT IN ('cancelada','concluida')
   ORDER BY t.created_at DESC LIMIT 1;
  IF td.id IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;

  IF TG_OP = 'DELETE'
     OR (OLD.expedition_deleted_at IS NULL AND NEW.expedition_deleted_at IS NOT NULL)
     OR (OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'cancelled')
     OR (OLD.status_cancelamento IS DISTINCT FROM NEW.status_cancelamento AND NEW.status_cancelamento::text = 'cancelado') THEN
    RAISE EXCEPTION 'TROCA_LOCK: produto da troca % não pode ser excluído da Expedição. Cancele a troca primeiro.', td.codigo_devolucao USING ERRCODE = 'P0001';
  END IF;

  IF (OLD.expedition_stage IS DISTINCT FROM NEW.expedition_stage AND NEW.expedition_stage = 'concluido')
     OR (OLD.shipped_at IS NULL AND NEW.shipped_at IS NOT NULL) THEN
    IF td.modo = 'aguarda_retorno' AND td.status IN ('iniciada','aguardando_retorno','recebido_conferencia') THEN
      RAISE EXCEPTION 'TROCA_LOCK: aguardando finalizar a troca % no PDV antes de concluir o envio.', td.codigo_devolucao USING ERRCODE = 'P0001';
    END IF;
    IF td.diferenca_venda_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.pos_sales s WHERE s.id = td.diferenca_venda_id
         AND s.status IN ('online_pending','pending','payment_failed')) THEN
      RAISE EXCEPTION 'TROCA_LOCK: a diferença da troca % ainda não foi paga.', td.codigo_devolucao USING ERRCODE = 'P0001';
    END IF;
    IF td.status = 'aguardando_envio' AND NEW.expedition_stage = 'concluido' THEN
      UPDATE public.trocas_devolucoes SET status = 'concluida', despachada_em = coalesce(despachada_em, now()),
        tracking_code = coalesce(tracking_code, nullif(trim(coalesce(NEW.tracking_code,'')),'')),
        tracking_carrier = coalesce(tracking_carrier, nullif(trim(coalesce(NEW.tracking_carrier, NEW.shipping_carrier,'')),'')),
        updated_at = now()
       WHERE id = td.id AND status::text = 'aguardando_envio';
    END IF;
  END IF;
  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS trg_pos_sales_exchange_lock_upd ON public.pos_sales;
CREATE TRIGGER trg_pos_sales_exchange_lock_upd BEFORE UPDATE ON public.pos_sales FOR EACH ROW
 WHEN ((old.expedition_stage IS DISTINCT FROM new.expedition_stage) OR (old.expedition_deleted_at IS DISTINCT FROM new.expedition_deleted_at)
   OR (old.shipped_at IS DISTINCT FROM new.shipped_at) OR (old.status IS DISTINCT FROM new.status)
   OR (old.status_cancelamento IS DISTINCT FROM new.status_cancelamento) OR (old.tracking_code IS DISTINCT FROM new.tracking_code))
 EXECUTE FUNCTION guard_exchange_replacement_sale();