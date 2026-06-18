CREATE TABLE IF NOT EXISTS public.internal_function_secrets (
  key text PRIMARY KEY,
  value text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Server-side only: never grant to anon or authenticated.
GRANT ALL ON public.internal_function_secrets TO service_role;

ALTER TABLE public.internal_function_secrets ENABLE ROW LEVEL SECURITY;

-- No policies for anon/authenticated => no access via Data API.
-- service_role bypasses RLS, so edge functions can read it.

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS update_internal_function_secrets_updated_at ON public.internal_function_secrets;
CREATE TRIGGER update_internal_function_secrets_updated_at
BEFORE UPDATE ON public.internal_function_secrets
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();