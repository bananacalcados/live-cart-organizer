CREATE OR REPLACE FUNCTION public.live_zap_phone_key(p_phone text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE d text := regexp_replace(coalesce(p_phone,''), '\D', '', 'g');
BEGIN
  IF d = '' THEN RETURN NULL; END IF;
  IF d LIKE '55%' AND length(d) IN (12,13) THEN d := substr(d, 3); END IF;
  IF length(d) NOT IN (10,11) THEN RETURN NULL; END IF;
  RETURN left(d,2) || right(d,8);
END;
$$;

CREATE OR REPLACE FUNCTION public.live_zap_after_match(p_click public.live_whatsapp_clicks, p_real_phone text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_click.fbc IS NOT NULL OR p_click.fbp IS NOT NULL OR p_click.fbclid IS NOT NULL THEN
    PERFORM public.upsert_meta_attribution(
      p_real_phone, p_click.fbc, p_click.fbp, NULL, p_click.fbclid,
      p_click.created_at, NULL, p_click.referer, 'live_whatsapp_link', NULL);
    IF p_click.entered_phone IS NOT NULL
       AND public.live_zap_phone_key(p_click.entered_phone) IS DISTINCT FROM public.live_zap_phone_key(p_real_phone) THEN
      PERFORM public.upsert_meta_attribution(
        p_click.entered_phone, p_click.fbc, p_click.fbp, NULL, p_click.fbclid,
        p_click.created_at, NULL, p_click.referer, 'live_whatsapp_link', NULL);
    END IF;
  END IF;

  IF p_click.entered_phone_key IS NOT NULL THEN
    UPDATE public.live_whatsapp_clicks
       SET superseded = true
     WHERE entered_phone_key = p_click.entered_phone_key
       AND phone IS NULL
       AND id <> p_click.id
       AND created_at <= p_click.created_at;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.live_zap_match_incoming()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_code text;
  v_key text;
  v_click public.live_whatsapp_clicks%ROWTYPE;
  v_other public.live_whatsapp_clicks%ROWTYPE;
  v_link public.live_whatsapp_links%ROWTYPE;
  v_msg text := coalesce(NEW.message, '');
  v_has_phrase boolean;
BEGIN
  v_key := public.live_zap_phone_key(NEW.phone);
  v_code := substring(v_msg from '#([A-Z0-9]{5})\M');
  v_has_phrase := v_msg ~* 'vim da live';

  IF v_code IS NULL AND NOT v_has_phrase THEN
    IF v_key IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.live_whatsapp_clicks c
       WHERE c.entered_phone_key = v_key AND c.phone IS NULL
         AND c.created_at > now() - interval '7 days'
    ) THEN
      RETURN NEW;
    END IF;
  END IF;

  -- 1) TELEFONE digitado (chave principal)
  IF v_key IS NOT NULL THEN
    SELECT c.* INTO v_click
      FROM public.live_whatsapp_clicks c
     WHERE c.entered_phone_key = v_key
       AND c.phone IS NULL
       AND c.created_at > now() - interval '7 days'
     ORDER BY c.confirmed_at DESC NULLS LAST, c.created_at DESC
     LIMIT 1;

    IF v_click.id IS NOT NULL THEN
      IF v_code IS NOT NULL AND v_click.code IS DISTINCT FROM v_code THEN
        SELECT c.* INTO v_other FROM public.live_whatsapp_clicks c WHERE c.code = v_code AND c.phone IS NULL LIMIT 1;
        IF v_other.id IS NOT NULL THEN
          UPDATE public.live_whatsapp_clicks SET divergent = true WHERE id = v_click.id;
          v_click := v_other;
          UPDATE public.live_whatsapp_clicks
             SET phone = NEW.phone, real_phone = NEW.phone,
                 whatsapp_number_id = NEW.whatsapp_number_id,
                 matched_at = now(), match_method = 'code', message_id = NEW.id
           WHERE id = v_click.id;
          PERFORM public.live_zap_after_match(v_click, NEW.phone);
          RETURN NEW;
        END IF;
      END IF;

      UPDATE public.live_whatsapp_clicks
         SET phone = NEW.phone, real_phone = NEW.phone,
             whatsapp_number_id = NEW.whatsapp_number_id,
             matched_at = now(), match_method = 'phone', message_id = NEW.id
       WHERE id = v_click.id;
      PERFORM public.live_zap_after_match(v_click, NEW.phone);
      RETURN NEW;
    END IF;
  END IF;

  -- 2) CÓDIGO curto (reserva)
  IF v_code IS NOT NULL THEN
    UPDATE public.live_whatsapp_clicks
       SET phone = NEW.phone, real_phone = NEW.phone,
           whatsapp_number_id = NEW.whatsapp_number_id,
           matched_at = now(), match_method = 'code', message_id = NEW.id
     WHERE code = v_code AND phone IS NULL
     RETURNING * INTO v_click;
    IF v_click.id IS NOT NULL THEN
      PERFORM public.live_zap_after_match(v_click, NEW.phone);
      RETURN NEW;
    END IF;
  END IF;

  -- 3) Janela de tempo: só cliques SEM telefone confirmado
  IF v_has_phrase THEN
    SELECT c.* INTO v_click
      FROM public.live_whatsapp_clicks c
      JOIN public.live_whatsapp_links l ON l.id = c.link_id
     WHERE c.phone IS NULL
       AND c.entered_phone_key IS NULL
       AND c.created_at > now() - interval '10 minutes'
       AND (NEW.whatsapp_number_id IS NULL OR l.whatsapp_number_id IS NULL OR l.whatsapp_number_id = NEW.whatsapp_number_id)
     ORDER BY c.created_at DESC
     LIMIT 1;

    IF v_click.id IS NOT NULL THEN
      UPDATE public.live_whatsapp_clicks
         SET phone = NEW.phone, real_phone = NEW.phone,
             whatsapp_number_id = NEW.whatsapp_number_id,
             matched_at = now(), match_method = 'time', message_id = NEW.id
       WHERE id = v_click.id;
      PERFORM public.live_zap_after_match(v_click, NEW.phone);
      RETURN NEW;
    END IF;

    -- 4) Contexto
    SELECT l.* INTO v_link
      FROM public.live_whatsapp_links l
      LEFT JOIN public.events e ON e.id = l.event_id
     WHERE l.is_active
       AND (l.whatsapp_number_id = NEW.whatsapp_number_id OR l.whatsapp_number_id IS NULL)
     ORDER BY (e.is_live_broadcasting IS TRUE) DESC, l.created_at DESC
     LIMIT 1;

    IF v_link.id IS NOT NULL THEN
      INSERT INTO public.live_whatsapp_clicks
        (link_id, event_id, phone, real_phone, whatsapp_number_id, matched_at, match_method, message_id)
      VALUES
        (v_link.id, v_link.event_id, NEW.phone, NEW.phone, NEW.whatsapp_number_id, now(), 'context', NEW.id);
    END IF;
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[live_zap_match_incoming] %', SQLERRM;
  RETURN NEW;
END;
$$;