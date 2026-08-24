CREATE OR REPLACE FUNCTION public.automation_phone_key(p_phone text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE d text;
BEGIN
  d := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  IF d = '' THEN RETURN ''; END IF;
  IF left(d, 2) = '55' AND length(d) IN (12, 13) THEN
    d := substr(d, 3);
  END IF;
  IF length(d) IN (10, 11) THEN
    RETURN left(d, 2) || right(d, 8);
  END IF;
  RETURN right(d, 8);
END;
$$;

CREATE TABLE public.automation_opt_outs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  phone text NOT NULL,
  phone_key text GENERATED ALWAYS AS (public.automation_phone_key(phone)) STORED,
  source text NOT NULL DEFAULT 'keyword',
  keyword text,
  whatsapp_number_id uuid REFERENCES public.whatsapp_numbers(id) ON DELETE SET NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX automation_opt_outs_phone_key_uniq ON public.automation_opt_outs (phone_key);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.automation_opt_outs TO authenticated;
GRANT ALL ON public.automation_opt_outs TO service_role;

ALTER TABLE public.automation_opt_outs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Equipe autenticada gerencia descadastros"
ON public.automation_opt_outs FOR ALL TO authenticated
USING (true) WITH CHECK (true);

CREATE TRIGGER trg_automation_opt_outs_updated_at
BEFORE UPDATE ON public.automation_opt_outs
FOR EACH ROW EXECUTE FUNCTION public._set_updated_at();

CREATE OR REPLACE FUNCTION public.is_automation_opted_out(p_phone text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.automation_opt_outs
    WHERE phone_key = public.automation_phone_key(p_phone)
      AND public.automation_phone_key(p_phone) <> ''
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_automation_opted_out(text) TO authenticated, service_role;