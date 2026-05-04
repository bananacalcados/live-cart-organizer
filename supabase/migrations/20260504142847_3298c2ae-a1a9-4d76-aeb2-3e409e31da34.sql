ALTER TABLE public.automation_pos_followups
  ADD COLUMN IF NOT EXISTS customer_cpf text;

CREATE INDEX IF NOT EXISTS idx_automation_pos_followups_cpf_pending
  ON public.automation_pos_followups (customer_cpf, flow_id)
  WHERE sent_at IS NULL AND cancelled_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_automation_pos_followups_phone_pending
  ON public.automation_pos_followups (customer_phone_suffix, flow_id)
  WHERE sent_at IS NULL AND cancelled_at IS NULL;