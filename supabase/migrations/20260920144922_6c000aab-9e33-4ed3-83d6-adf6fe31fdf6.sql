
CREATE OR REPLACE FUNCTION public.pos_customers_require_contact()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NULLIF(btrim(COALESCE(NEW.whatsapp, '')), '') IS NULL
     AND NULLIF(btrim(COALESCE(NEW.cpf, '')), '') IS NULL
     AND NULLIF(btrim(COALESCE(NEW.email, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Preencha pelo menos um contato (WhatsApp, CPF ou e-mail). Se o cliente não quiser informar, finalize a venda sem identificar cliente (Consumidor Final).'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pos_customers_require_contact ON public.pos_customers;
CREATE TRIGGER trg_pos_customers_require_contact
  BEFORE INSERT ON public.pos_customers
  FOR EACH ROW EXECUTE FUNCTION public.pos_customers_require_contact();
