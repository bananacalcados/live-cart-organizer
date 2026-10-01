CREATE TABLE public.appmax_installations (
  env text PRIMARY KEY CHECK (env IN ('sandbox','production')),
  external_id uuid NOT NULL DEFAULT gen_random_uuid(),
  external_key text,
  app_numeric_id bigint,
  merchant_client_id text,
  merchant_client_secret text,
  status text NOT NULL DEFAULT 'pending',
  last_error text,
  installed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.appmax_installations TO service_role;
ALTER TABLE public.appmax_installations ENABLE ROW LEVEL SECURITY;