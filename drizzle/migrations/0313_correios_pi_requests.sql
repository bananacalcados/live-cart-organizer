CREATE TABLE public.correios_pi_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 sale_id uuid NOT NULL REFERENCES public.pos_sales(id),
 shipment_id uuid REFERENCES public.shipment_simulations(id),
 codigo_objeto text NOT NULL,
 motivo_codigo integer NOT NULL,
 motivo_descricao text NOT NULL,
 tipo_manifestacao text NOT NULL DEFAULT 'R' CHECK (tipo_manifestacao IN ('R','I')),
 status text NOT NULL DEFAULT 'aberto' CHECK (status IN ('aberto','respondido','reativado','encerrado','erro')),
 protocolo text,
 request_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
 response_open jsonb,
 last_status_payload jsonb,
 resposta_texto text,
 opened_at timestamptz NOT NULL DEFAULT now(),
 last_checked_at timestamptz,
 answered_at timestamptz,
 opened_by uuid,
 error_message text
);
GRANT SELECT ON public.correios_pi_requests TO authenticated;
GRANT ALL ON public.correios_pi_requests TO service_role;
ALTER TABLE public.correios_pi_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY correios_pi_team_read ON public.correios_pi_requests FOR SELECT TO authenticated USING ((select public.is_team_member((select auth.uid()))));
CREATE UNIQUE INDEX correios_pi_one_active_object ON public.correios_pi_requests(codigo_objeto) WHERE status IN ('aberto','respondido','reativado');
CREATE INDEX correios_pi_sale_opened ON public.correios_pi_requests(sale_id,opened_at DESC,id DESC);
CREATE INDEX correios_pi_shipment ON public.correios_pi_requests(shipment_id);
CREATE INDEX correios_pi_opened ON public.correios_pi_requests(opened_at DESC,id DESC);
CREATE INDEX correios_pi_pending_check ON public.correios_pi_requests(last_checked_at ASC NULLS FIRST,id) WHERE status IN ('aberto','reativado');
COMMENT ON TABLE public.correios_pi_requests IS 'Isolated Correios information requests; no writes to sales, stock or shipment records. Uncertain opening remains active until reconciled; never retry automatically.';