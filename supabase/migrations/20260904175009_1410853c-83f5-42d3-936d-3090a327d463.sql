CREATE TABLE public.chat_conversation_lanes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_key text NOT NULL,
  whatsapp_number_id text NOT NULL DEFAULT '',
  lane text NOT NULL CHECK (lane IN ('new', 'unread', 'followup', 'support')),
  moved_by uuid DEFAULT auth.uid(),
  moved_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (phone_key, whatsapp_number_id)
);

CREATE INDEX idx_chat_conversation_lanes_phone ON public.chat_conversation_lanes(phone_key);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.chat_conversation_lanes TO authenticated;
GRANT ALL ON public.chat_conversation_lanes TO service_role;

ALTER TABLE public.chat_conversation_lanes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can manage chat conversation lanes"
ON public.chat_conversation_lanes
FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);

CREATE TRIGGER trg_chat_conversation_lanes_updated_at
BEFORE UPDATE ON public.chat_conversation_lanes
FOR EACH ROW EXECUTE FUNCTION public._set_updated_at();

ALTER TABLE public.chat_conversation_lanes REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_conversation_lanes;

-- Limpa a marcação manual quando a cliente manda nova mensagem.
CREATE OR REPLACE FUNCTION public.chat_lane_clear_on_incoming()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_key text;
BEGIN
  v_key := right(regexp_replace(coalesce(NEW.phone, ''), '\D', '', 'g'), 8);
  IF length(v_key) < 8 THEN RETURN NEW; END IF;
  DELETE FROM public.chat_conversation_lanes WHERE phone_key = v_key;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_chat_lane_clear_on_incoming ON public.whatsapp_messages;
CREATE TRIGGER trg_chat_lane_clear_on_incoming
AFTER INSERT ON public.whatsapp_messages
FOR EACH ROW
WHEN (NEW.direction = 'incoming' AND NEW.is_group IS NOT TRUE)
EXECUTE FUNCTION public.chat_lane_clear_on_incoming();

-- Limpa a marcação manual quando a conversa é finalizada.
CREATE OR REPLACE FUNCTION public.chat_lane_clear_on_finish()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_key text;
BEGIN
  v_key := right(regexp_replace(coalesce(NEW.phone, ''), '\D', '', 'g'), 8);
  IF length(v_key) < 8 THEN RETURN NEW; END IF;
  DELETE FROM public.chat_conversation_lanes WHERE phone_key = v_key;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_chat_lane_clear_on_finish ON public.chat_finished_conversations;
CREATE TRIGGER trg_chat_lane_clear_on_finish
AFTER INSERT OR UPDATE OF finished_at ON public.chat_finished_conversations
FOR EACH ROW
EXECUTE FUNCTION public.chat_lane_clear_on_finish();