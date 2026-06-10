CREATE TABLE IF NOT EXISTS public.uazapi_contact_backfill_state (
  whatsapp_number_id uuid PRIMARY KEY REFERENCES public.whatsapp_numbers(id) ON DELETE CASCADE,
  "offset" integer NOT NULL DEFAULT 0,
  done boolean NOT NULL DEFAULT false,
  last_succeeded integer NOT NULL DEFAULT 0,
  last_failed integer NOT NULL DEFAULT 0,
  total_succeeded integer NOT NULL DEFAULT 0,
  total_failed integer NOT NULL DEFAULT 0,
  locked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.uazapi_contact_backfill_state TO authenticated;
GRANT ALL ON public.uazapi_contact_backfill_state TO service_role;

ALTER TABLE public.uazapi_contact_backfill_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth read backfill state"
  ON public.uazapi_contact_backfill_state
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "service manages backfill state"
  ON public.uazapi_contact_backfill_state
  FOR ALL TO service_role USING (true) WITH CHECK (true);