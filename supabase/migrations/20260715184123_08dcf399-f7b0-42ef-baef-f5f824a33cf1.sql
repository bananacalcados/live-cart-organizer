
CREATE INDEX IF NOT EXISTS idx_automation_dispatch_sent_sent_at
  ON public.automation_dispatch_sent (sent_at);

COMMENT ON COLUMN public.automation_dispatch_sent.template_category_at_send IS
  'Snapshot da categoria do template Meta (marketing/utility/authentication) no momento do envio. Congelado — reclassificações posteriores não alteram este valor.';
COMMENT ON COLUMN public.automation_dispatch_sent.unit_cost_at_send IS
  'Snapshot do custo unitário em BRL cobrado pelo provedor no momento do envio.';
COMMENT ON COLUMN public.automation_dispatch_sent.provider_at_send IS
  'Snapshot do provedor usado no envio (meta/uazapi/wasender).';
