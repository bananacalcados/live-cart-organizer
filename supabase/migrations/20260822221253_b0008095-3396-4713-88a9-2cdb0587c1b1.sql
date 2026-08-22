
CREATE OR REPLACE FUNCTION public.cancel_expedition_on_order_unpaid_stage()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  -- ETAPAS QUE DISPARAM a retirada da expedição (pré-pagamento / cancelado)
  v_revert_stages text[] := ARRAY['cancelled','awaiting_payment','new','awaiting_confirmation','incomplete_order','pre_sale'];
  -- ETAPAS PÓS-PAGAMENTO: nunca disparam
  v_paid_stages   text[] := ARRAY['paid','completed','shipped','awaiting_shipping','awaiting_mototaxi','awaiting_pickup'];
  v_sale record;
BEGIN
  -- só reage a mudança real de etapa
  IF TG_OP <> 'UPDATE' OR NEW.stage IS NOT DISTINCT FROM OLD.stage THEN
    RETURN NEW;
  END IF;

  -- destino precisa estar na lista de reversão
  IF NOT (NEW.stage = ANY(v_revert_stages)) THEN
    RETURN NEW;
  END IF;

  -- origem precisa ser uma etapa pós-pagamento (ou pedido marcado como pago)
  IF NOT (OLD.stage = ANY(v_paid_stages)) AND COALESCE(OLD.is_paid,false) IS NOT TRUE THEN
    RETURN NEW;
  END IF;

  FOR v_sale IN
    SELECT id, expedition_stage
    FROM public.pos_sales
    WHERE source_order_id = NEW.id
      AND status IS DISTINCT FROM 'cancelled'
  LOOP
    -- venda já finalizada na expedição: não mexe (apenas registra aviso)
    IF v_sale.expedition_stage = 'concluido' THEN
      RAISE WARNING 'Pedido % movido para % mas venda % já está concluída na expedição — não cancelada automaticamente', NEW.id, NEW.stage, v_sale.id;
      CONTINUE;
    END IF;

    BEGIN
      PERFORM public.expedition_cancel_sale(
        v_sale.id,
        'Pedido movido para etapa "' || NEW.stage || '" no Kanban da Live (automático)',
        true
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Falha ao cancelar venda % do pedido %: %', v_sale.id, NEW.id, SQLERRM;
    END;
  END LOOP;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_cancel_expedition_on_order_unpaid_stage ON public.orders;
CREATE TRIGGER trg_cancel_expedition_on_order_unpaid_stage
AFTER UPDATE OF stage ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.cancel_expedition_on_order_unpaid_stage();
