CREATE TABLE IF NOT EXISTS public.customer_access_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone text NOT NULL UNIQUE,
  code text NOT NULL,
  customer_name text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);
CREATE INDEX IF NOT EXISTS idx_customer_access_codes_code ON public.customer_access_codes(code);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.customer_access_codes TO authenticated;
GRANT ALL ON public.customer_access_codes TO service_role;
ALTER TABLE public.customer_access_codes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "staff manage access codes" ON public.customer_access_codes;
CREATE POLICY "staff manage access codes" ON public.customer_access_codes
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.otp_template_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  whatsapp_number_id uuid,
  template_name text,
  template_language text NOT NULL DEFAULT 'pt_BR',
  code_variable_index integer NOT NULL DEFAULT 1,
  copy_code_button boolean NOT NULL DEFAULT false,
  fallback_to_text boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.otp_template_settings (id) VALUES (true) ON CONFLICT (id) DO NOTHING;
GRANT SELECT, INSERT, UPDATE ON public.otp_template_settings TO authenticated;
GRANT ALL ON public.otp_template_settings TO service_role;
ALTER TABLE public.otp_template_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "staff manage otp settings" ON public.otp_template_settings;
CREATE POLICY "staff manage otp settings" ON public.otp_template_settings
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.get_or_create_customer_access_code(_phone text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE d text; e164 text; c text; i int := 0;
BEGIN
  d := regexp_replace(coalesce(_phone, ''), '\D', '', 'g');
  IF left(d, 2) = '55' AND length(d) > 11 THEN d := substr(d, 3); END IF;
  IF length(d) = 10 THEN d := substr(d, 1, 2) || '9' || substr(d, 3); END IF;
  IF length(d) <> 11 THEN RETURN NULL; END IF;
  e164 := '55' || d;

  SELECT code INTO c FROM public.customer_access_codes WHERE phone = e164;
  IF c IS NOT NULL THEN RETURN c; END IF;

  LOOP
    i := i + 1;
    c := lpad(((floor(random() * 900000) + 100000))::int::text, 6, '0');
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.customer_access_codes WHERE code = c) OR i > 50;
  END LOOP;

  INSERT INTO public.customer_access_codes (phone, code)
  VALUES (e164, c)
  ON CONFLICT (phone) DO UPDATE SET updated_at = now()
  RETURNING code INTO c;

  RETURN c;
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_or_create_customer_access_code(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.set_customer_access_code(_phone text, _code text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE d text; e164 text; c text;
BEGIN
  d := regexp_replace(coalesce(_phone, ''), '\D', '', 'g');
  IF left(d, 2) = '55' AND length(d) > 11 THEN d := substr(d, 3); END IF;
  IF length(d) = 10 THEN d := substr(d, 1, 2) || '9' || substr(d, 3); END IF;
  IF length(d) <> 11 THEN RETURN NULL; END IF;
  e164 := '55' || d;
  c := regexp_replace(coalesce(_code, ''), '\D', '', 'g');
  IF length(c) < 4 OR length(c) > 8 THEN RAISE EXCEPTION 'Código deve ter de 4 a 8 dígitos'; END IF;

  INSERT INTO public.customer_access_codes (phone, code, updated_by)
  VALUES (e164, c, auth.uid())
  ON CONFLICT (phone) DO UPDATE SET code = excluded.code, updated_at = now(), updated_by = auth.uid()
  RETURNING code INTO c;
  RETURN c;
END;
$$;
GRANT EXECUTE ON FUNCTION public.set_customer_access_code(text, text) TO authenticated, service_role;

SELECT public.get_or_create_customer_access_code('5533900001111');
SELECT public.get_or_create_customer_access_code('5533900002222');