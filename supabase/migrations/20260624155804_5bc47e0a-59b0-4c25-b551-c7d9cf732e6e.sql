CREATE TABLE public.meta_template_status_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  template_id TEXT NOT NULL UNIQUE,
  template_name TEXT,
  language TEXT,
  event TEXT,
  rejected_reason TEXT,
  raw_payload JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.meta_template_status_log TO authenticated;
GRANT ALL ON public.meta_template_status_log TO service_role;

ALTER TABLE public.meta_template_status_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read template status log"
ON public.meta_template_status_log
FOR SELECT
TO authenticated
USING (true);

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_meta_template_status_log_updated_at
BEFORE UPDATE ON public.meta_template_status_log
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();