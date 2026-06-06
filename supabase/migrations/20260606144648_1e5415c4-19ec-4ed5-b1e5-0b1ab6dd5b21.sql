CREATE OR REPLACE FUNCTION public.sync_registration_to_pos_customer()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cpf text := regexp_replace(coalesce(NEW.cpf, ''), '\D', '', 'g');
  v_phone text := regexp_replace(coalesce(NEW.whatsapp, ''), '\D', '', 'g');
  v_existing uuid;
BEGIN
  IF length(v_cpf) = 11 THEN
    SELECT id INTO v_existing FROM public.pos_customers
      WHERE regexp_replace(coalesce(cpf, ''), '\D', '', 'g') = v_cpf
      LIMIT 1;
  END IF;

  IF v_existing IS NULL AND length(v_phone) >= 10 THEN
    SELECT id INTO v_existing FROM public.pos_customers
      WHERE right(regexp_replace(coalesce(whatsapp, ''), '\D', '', 'g'), 8) = right(v_phone, 8)
      LIMIT 1;
  END IF;

  IF v_existing IS NOT NULL THEN
    UPDATE public.pos_customers SET
      name = coalesce(nullif(NEW.full_name, ''), name),
      email = coalesce(nullif(NEW.email, ''), email),
      whatsapp = coalesce(nullif(NEW.whatsapp, ''), whatsapp),
      cpf = coalesce(nullif(v_cpf, ''), cpf),
      cep = coalesce(nullif(NEW.cep, ''), cep),
      address = coalesce(nullif(NEW.address, ''), address),
      address_number = coalesce(nullif(NEW.address_number, ''), address_number),
      complement = coalesce(nullif(NEW.complement, ''), complement),
      neighborhood = coalesce(nullif(NEW.neighborhood, ''), neighborhood),
      city = coalesce(nullif(NEW.city, ''), city),
      state = coalesce(nullif(NEW.state, ''), state),
      updated_at = now()
    WHERE id = v_existing;
  ELSE
    INSERT INTO public.pos_customers
      (name, email, whatsapp, cpf, cep, address, address_number, complement, neighborhood, city, state)
    VALUES (
      coalesce(nullif(NEW.full_name, ''), 'Cliente'),
      nullif(NEW.email, ''),
      nullif(NEW.whatsapp, ''),
      nullif(v_cpf, ''),
      nullif(NEW.cep, ''),
      nullif(NEW.address, ''),
      nullif(NEW.address_number, ''),
      nullif(NEW.complement, ''),
      nullif(NEW.neighborhood, ''),
      nullif(NEW.city, ''),
      nullif(NEW.state, '')
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_registration_to_pos_customer ON public.customer_registrations;
CREATE TRIGGER trg_sync_registration_to_pos_customer
AFTER INSERT OR UPDATE ON public.customer_registrations
FOR EACH ROW EXECUTE FUNCTION public.sync_registration_to_pos_customer();

-- One-time backfill of existing checkout registrations into pos_customers
UPDATE public.customer_registrations SET updated_at = now();