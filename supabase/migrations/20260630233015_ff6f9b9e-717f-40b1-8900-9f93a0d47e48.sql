-- Captação de leads pelos comentários da Live do Instagram
-- Estende as regras de automação de comentários para capturar leads de evento.

ALTER TABLE public.instagram_comment_rules
  ADD COLUMN IF NOT EXISTS action_capture_lead boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS capture_event_id uuid REFERENCES public.events(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS capture_mode text NOT NULL DEFAULT 'phone',
  ADD COLUMN IF NOT EXISTS capture_fallback_dm_text text;

-- Validação do modo de captura via trigger (CHECK constraints podem complicar restores)
CREATE OR REPLACE FUNCTION public.validate_ig_capture_mode()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.capture_mode IS NOT NULL AND NEW.capture_mode NOT IN ('phone', 'keyword') THEN
    RAISE EXCEPTION 'capture_mode deve ser phone ou keyword';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_ig_capture_mode ON public.instagram_comment_rules;
CREATE TRIGGER trg_validate_ig_capture_mode
  BEFORE INSERT OR UPDATE ON public.instagram_comment_rules
  FOR EACH ROW EXECUTE FUNCTION public.validate_ig_capture_mode();

-- Origem de captação por comentário de live em event_leads:
-- adiciona coluna instagram para guardar o @ de quem comentou (além de metadata).
ALTER TABLE public.event_leads
  ADD COLUMN IF NOT EXISTS instagram text;

-- Índice para dedup/consulta por @ dentro de um evento
CREATE INDEX IF NOT EXISTS idx_event_leads_event_instagram
  ON public.event_leads (event_id, instagram);