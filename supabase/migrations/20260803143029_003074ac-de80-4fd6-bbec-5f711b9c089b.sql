ALTER TABLE public.pos_commission_people
  ADD COLUMN IF NOT EXISTS role_title text,
  ADD COLUMN IF NOT EXISTS is_employee_only boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS provision_13 boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS provision_vacation boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS provision_notice boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS provision_charges_percent numeric NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.pos_payroll_period_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id uuid NOT NULL REFERENCES public.pos_commission_people(id) ON DELETE CASCADE,
  period_start date NOT NULL,
  period_end date NOT NULL,
  overtime_hours numeric NOT NULL DEFAULT 0,
  overtime_value numeric NOT NULL DEFAULT 0,
  benefits_bonus numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (person_id, period_start, period_end)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pos_payroll_period_entries TO authenticated;
GRANT ALL ON public.pos_payroll_period_entries TO service_role;

ALTER TABLE public.pos_payroll_period_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can manage payroll period entries"
ON public.pos_payroll_period_entries FOR ALL TO authenticated
USING (true) WITH CHECK (true);

CREATE TRIGGER update_pos_payroll_period_entries_updated_at
BEFORE UPDATE ON public.pos_payroll_period_entries
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();