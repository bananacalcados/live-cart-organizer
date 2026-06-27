-- ════════════════════════════════════════════════════════════════════
-- Etapa 1: Rastreamento de membros de grupos WhatsApp (movimentação)
-- Puramente aditivo. Não altera nenhuma tabela/fluxo existente.
-- ════════════════════════════════════════════════════════════════════

-- Estado ATUAL de cada membro por grupo+instância (1 linha por telefone/grupo)
CREATE TABLE public.whatsapp_group_members (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  group_id text NOT NULL,                 -- dígitos do JID do grupo (chave estável, igual a whatsapp_groups.group_id)
  instance_id text,                       -- whatsapp_number_id da instância que viu o evento
  phone text NOT NULL,                    -- telefone E.164 normalizado do participante
  jid text,                               -- JID bruto recebido (auditoria)
  status text NOT NULL DEFAULT 'member',  -- member | left | removed
  is_admin boolean NOT NULL DEFAULT false,
  is_internal boolean NOT NULL DEFAULT false, -- true = número da empresa ou vendedor (ignorar no scoring)
  internal_kind text,                     -- 'instance' | 'seller' | null
  customer_id uuid,                       -- vínculo opcional com customers_unified (enriquecimento)
  display_name text,
  joined_at timestamptz,                  -- primeira vez visto entrando
  left_at timestamptz,                    -- última vez visto saindo
  last_event_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT whatsapp_group_members_unique UNIQUE (group_id, instance_id, phone)
);

CREATE INDEX idx_wa_group_members_group ON public.whatsapp_group_members (group_id);
CREATE INDEX idx_wa_group_members_phone ON public.whatsapp_group_members (phone);
CREATE INDEX idx_wa_group_members_status ON public.whatsapp_group_members (status);
CREATE INDEX idx_wa_group_members_customer ON public.whatsapp_group_members (customer_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.whatsapp_group_members TO authenticated;
GRANT ALL ON public.whatsapp_group_members TO service_role;

ALTER TABLE public.whatsapp_group_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read group members"
  ON public.whatsapp_group_members FOR SELECT TO authenticated USING (true);
CREATE POLICY "Service role manages group members"
  ON public.whatsapp_group_members FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Histórico de MOVIMENTAÇÃO (append-only): entrou/saiu/promovido etc.
CREATE TABLE public.whatsapp_group_member_events (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  group_id text NOT NULL,
  instance_id text,
  phone text NOT NULL,
  jid text,
  event_type text NOT NULL,               -- joined | left | removed | added | promoted | demoted
  is_internal boolean NOT NULL DEFAULT false,
  actor_phone text,                       -- quem executou (quando a API informa, ex.: admin que removeu)
  customer_id uuid,
  display_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_wa_group_member_events_group ON public.whatsapp_group_member_events (group_id);
CREATE INDEX idx_wa_group_member_events_phone ON public.whatsapp_group_member_events (phone);
CREATE INDEX idx_wa_group_member_events_type ON public.whatsapp_group_member_events (event_type);
CREATE INDEX idx_wa_group_member_events_created ON public.whatsapp_group_member_events (created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.whatsapp_group_member_events TO authenticated;
GRANT ALL ON public.whatsapp_group_member_events TO service_role;

ALTER TABLE public.whatsapp_group_member_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read group member events"
  ON public.whatsapp_group_member_events FOR SELECT TO authenticated USING (true);
CREATE POLICY "Service role manages group member events"
  ON public.whatsapp_group_member_events FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Trigger updated_at (reusa função padrão se existir; cria se não)
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER trg_wa_group_members_updated_at
  BEFORE UPDATE ON public.whatsapp_group_members
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();