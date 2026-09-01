CREATE TABLE public.live_whatsapp_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid REFERENCES public.events(id) ON DELETE CASCADE,
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  whatsapp_number_id uuid REFERENCES public.whatsapp_numbers(id) ON DELETE SET NULL,
  target_phone text NOT NULL,
  message_text text NOT NULL DEFAULT 'Oii, vim da Live, pode me ajudar?',
  is_active boolean NOT NULL DEFAULT true,
  click_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_live_whatsapp_links_event ON public.live_whatsapp_links(event_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.live_whatsapp_links TO authenticated;
GRANT ALL ON public.live_whatsapp_links TO service_role;
ALTER TABLE public.live_whatsapp_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth manage live_whatsapp_links" ON public.live_whatsapp_links
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TABLE public.live_whatsapp_clicks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  link_id uuid REFERENCES public.live_whatsapp_links(id) ON DELETE CASCADE,
  event_id uuid REFERENCES public.events(id) ON DELETE SET NULL,
  code text UNIQUE,
  fbc text,
  fbp text,
  fbclid text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  utm_term text,
  user_agent text,
  ip text,
  referer text,
  phone text,
  whatsapp_number_id uuid,
  matched_at timestamptz,
  match_method text,
  message_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_live_whatsapp_clicks_link_created ON public.live_whatsapp_clicks(link_id, created_at DESC);
CREATE INDEX idx_live_whatsapp_clicks_event_phone ON public.live_whatsapp_clicks(event_id, phone);
CREATE INDEX idx_live_whatsapp_clicks_unmatched ON public.live_whatsapp_clicks(whatsapp_number_id, created_at DESC) WHERE phone IS NULL;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.live_whatsapp_clicks TO authenticated;
GRANT ALL ON public.live_whatsapp_clicks TO service_role;
ALTER TABLE public.live_whatsapp_clicks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth manage live_whatsapp_clicks" ON public.live_whatsapp_clicks
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TRIGGER trg_live_whatsapp_links_updated_at
  BEFORE UPDATE ON public.live_whatsapp_links
  FOR EACH ROW EXECUTE FUNCTION public._set_updated_at();

-- Casamento clique ↔ mensagem recebida (híbrido: código > tempo > contexto)
CREATE OR REPLACE FUNCTION public.live_zap_match_incoming()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_code text;
  v_click public.live_whatsapp_clicks%ROWTYPE;
  v_link public.live_whatsapp_links%ROWTYPE;
  v_msg text := coalesce(NEW.message, '');
BEGIN
  -- Fast path: só mensagens que contenham o código ou a frase da live
  IF v_msg !~ '#[A-Z0-9]{5}\M' AND v_msg !~* 'vim da live' THEN
    RETURN NEW;
  END IF;

  -- 1) Código curto
  v_code := substring(v_msg from '#([A-Z0-9]{5})\M');
  IF v_code IS NOT NULL THEN
    UPDATE public.live_whatsapp_clicks
       SET phone = NEW.phone,
           whatsapp_number_id = NEW.whatsapp_number_id,
           matched_at = now(),
           match_method = 'code',
           message_id = NEW.id
     WHERE code = v_code AND phone IS NULL
     RETURNING * INTO v_click;
    IF v_click.id IS NOT NULL THEN
      IF v_click.fbc IS NOT NULL OR v_click.fbp IS NOT NULL OR v_click.fbclid IS NOT NULL THEN
        PERFORM public.upsert_meta_attribution(
          NEW.phone, v_click.fbc, v_click.fbp, NULL, v_click.fbclid,
          v_click.created_at, NULL, v_click.referer, 'live_whatsapp_link', NULL);
      END IF;
      RETURN NEW;
    END IF;
  END IF;

  -- 2) Sem código válido mas com a frase: casa pelo clique mais recente (10 min) na mesma instância
  IF v_msg ~* 'vim da live' THEN
    SELECT c.* INTO v_click
      FROM public.live_whatsapp_clicks c
      JOIN public.live_whatsapp_links l ON l.id = c.link_id
     WHERE c.phone IS NULL
       AND c.created_at > now() - interval '10 minutes'
       AND (NEW.whatsapp_number_id IS NULL OR l.whatsapp_number_id IS NULL OR l.whatsapp_number_id = NEW.whatsapp_number_id)
     ORDER BY c.created_at DESC
     LIMIT 1;

    IF v_click.id IS NOT NULL THEN
      UPDATE public.live_whatsapp_clicks
         SET phone = NEW.phone,
             whatsapp_number_id = NEW.whatsapp_number_id,
             matched_at = now(),
             match_method = 'time',
             message_id = NEW.id
       WHERE id = v_click.id;
      IF v_click.fbc IS NOT NULL OR v_click.fbp IS NOT NULL OR v_click.fbclid IS NOT NULL THEN
        PERFORM public.upsert_meta_attribution(
          NEW.phone, v_click.fbc, v_click.fbp, NULL, v_click.fbclid,
          v_click.created_at, NULL, v_click.referer, 'live_whatsapp_link', NULL);
      END IF;
      RETURN NEW;
    END IF;

    -- 3) Contexto: marca como "veio da Live" sem fbc/fbp
    SELECT l.* INTO v_link
      FROM public.live_whatsapp_links l
      LEFT JOIN public.events e ON e.id = l.event_id
     WHERE l.is_active
       AND (l.whatsapp_number_id = NEW.whatsapp_number_id OR l.whatsapp_number_id IS NULL)
     ORDER BY (e.is_live_broadcasting IS TRUE) DESC, l.created_at DESC
     LIMIT 1;

    IF v_link.id IS NOT NULL THEN
      INSERT INTO public.live_whatsapp_clicks
        (link_id, event_id, phone, whatsapp_number_id, matched_at, match_method, message_id)
      VALUES
        (v_link.id, v_link.event_id, NEW.phone, NEW.whatsapp_number_id, now(), 'context', NEW.id);
    END IF;
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[live_zap_match_incoming] %', SQLERRM;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_live_zap_match_incoming
  AFTER INSERT ON public.whatsapp_messages
  FOR EACH ROW
  WHEN (NEW.direction = 'incoming' AND NEW.is_group IS NOT TRUE AND NEW.message IS NOT NULL)
  EXECUTE FUNCTION public.live_zap_match_incoming();