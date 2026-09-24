CREATE OR REPLACE FUNCTION public.sync_cash_register_movement_totals()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE rid uuid := COALESCE(NEW.cash_register_id, OLD.cash_register_id);
BEGIN
  IF rid IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;
  UPDATE public.pos_cash_registers r SET
    withdrawals = COALESCE((SELECT sum(amount) FROM public.pos_cash_movements WHERE cash_register_id = rid AND type='withdraw'),0),
    deposits    = COALESCE((SELECT sum(amount) FROM public.pos_cash_movements WHERE cash_register_id = rid AND type='deposit'),0)
  WHERE r.id = rid;
  RETURN COALESCE(NEW, OLD);
END $$;

DROP TRIGGER IF EXISTS trg_sync_cash_register_movement_totals ON public.pos_cash_movements;
CREATE TRIGGER trg_sync_cash_register_movement_totals
AFTER INSERT OR UPDATE OR DELETE ON public.pos_cash_movements
FOR EACH ROW EXECUTE FUNCTION public.sync_cash_register_movement_totals();

CREATE OR REPLACE FUNCTION public.block_movement_on_closed_register()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.cash_register_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.pos_cash_registers WHERE id = NEW.cash_register_id AND status = 'closed'
  ) THEN
    RAISE EXCEPTION 'Este caixa já foi fechado. Atualize a tela.';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_block_movement_on_closed_register ON public.pos_cash_movements;
CREATE TRIGGER trg_block_movement_on_closed_register
BEFORE INSERT ON public.pos_cash_movements
FOR EACH ROW EXECUTE FUNCTION public.block_movement_on_closed_register();

-- Corrige os totais dos caixas abertos (os fechados ficam como estão para preservar o histórico)
UPDATE public.pos_cash_registers r SET
  withdrawals = COALESCE((SELECT sum(amount) FROM public.pos_cash_movements m WHERE m.cash_register_id = r.id AND type='withdraw'),0),
  deposits    = COALESCE((SELECT sum(amount) FROM public.pos_cash_movements m WHERE m.cash_register_id = r.id AND type='deposit'),0)
WHERE r.status = 'open';