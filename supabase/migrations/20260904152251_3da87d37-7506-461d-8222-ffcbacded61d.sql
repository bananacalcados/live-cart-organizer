ALTER TABLE public.event_leads DROP CONSTRAINT IF EXISTS event_leads_source_check;
ALTER TABLE public.event_leads ADD CONSTRAINT event_leads_source_check
  CHECK (source = ANY (ARRAY['lp','typebot','referral','manual','member_area','live','live_whatsapp_link']));

ALTER TABLE public.live_whatsapp_clicks ADD COLUMN IF NOT EXISTS lead_id uuid REFERENCES public.event_leads(id) ON DELETE SET NULL;

-- Cria/atualiza o lead do evento a partir de um clique confirmado (chamado pela função de redirect)
CREATE OR REPLACE FUNCTION public.live_zap_upsert_lead(p_click_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c public.live_whatsapp_clicks%ROWTYPE;
  l public.live_whatsapp_links%ROWTYPE;
  v_lead_id uuid;
  v_meta jsonb;
BEGIN
  SELECT * INTO c FROM public.live_whatsapp_clicks WHERE id = p_click_id;
  IF c.id IS NULL OR c.entered_phone IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO l FROM public.live_whatsapp_links WHERE id = c.link_id;
  IF l.event_id IS NULL THEN RETURN NULL; END IF;

  v_meta := jsonb_strip_nulls(jsonb_build_object(
    'fbc', c.fbc, 'fbp', c.fbp, 'fbclid', c.fbclid, 'ip', c.ip, 'user_agent', c.user_agent,
    'referer', c.referer, 'click_id', c.id, 'link_id', c.link_id, 'link_slug', l.slug,
    'captured_at', c.confirmed_at));

  -- Já existe lead deste evento com o mesmo DDD+8?
  SELECT id INTO v_lead_id
    FROM public.event_leads
   WHERE event_id = l.event_id
     AND phone_suffix = right(c.entered_phone_key, 8)
     AND left(bc_phone_key(phone), 2) = left(c.entered_phone_key, 2)
   ORDER BY created_at ASC
   LIMIT 1;
  IF v_lead_id IS NULL THEN
    SELECT id INTO v_lead_id FROM public.event_leads
     WHERE event_id = l.event_id AND phone_suffix = right(c.entered_phone_key, 8)
     ORDER BY created_at ASC LIMIT 1;
  END IF;

  IF v_lead_id IS NOT NULL THEN
    UPDATE public.event_leads
       SET metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('live_whatsapp_link', v_meta),
           utm_source = coalesce(utm_source, c.utm_source),
           utm_medium = coalesce(utm_medium, c.utm_medium),
           utm_campaign = coalesce(utm_campaign, c.utm_campaign),
           utm_content = coalesce(utm_content, c.utm_content),
           utm_term = coalesce(utm_term, c.utm_term),
           link_slug = coalesce(link_slug, l.slug)
     WHERE id = v_lead_id;
  ELSE
    INSERT INTO public.event_leads
      (event_id, name, phone, source, link_slug, utm_source, utm_medium, utm_campaign, utm_content, utm_term, metadata)
    VALUES
      (l.event_id, 'Lead WhatsApp', c.entered_phone, 'live_whatsapp_link', l.slug,
       c.utm_source, c.utm_medium, c.utm_campaign, c.utm_content, c.utm_term,
       jsonb_build_object('live_whatsapp_link', v_meta))
    ON CONFLICT (event_id, phone) DO UPDATE
      SET metadata = coalesce(public.event_leads.metadata, '{}'::jsonb) || EXCLUDED.metadata
    RETURNING id INTO v_lead_id;
  END IF;

  UPDATE public.live_whatsapp_clicks SET lead_id = v_lead_id WHERE id = c.id;

  -- Memória de atribuição já no clique confirmado (antes mesmo da mensagem chegar)
  IF c.fbc IS NOT NULL OR c.fbp IS NOT NULL OR c.fbclid IS NOT NULL THEN
    PERFORM public.upsert_meta_attribution(
      c.entered_phone, c.fbc, c.fbp, NULL, c.fbclid, c.created_at, NULL, c.referer, 'live_whatsapp_link', v_lead_id);
  END IF;

  RETURN v_lead_id;
END;
$$;
REVOKE ALL ON FUNCTION public.live_zap_upsert_lead(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.live_zap_upsert_lead(uuid) TO service_role;

-- Pós-casamento: memória nos dois telefones, cliques repetidos e nome do lead
CREATE OR REPLACE FUNCTION public.live_zap_after_match(p_click public.live_whatsapp_clicks, p_real_phone text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_name text;
BEGIN
  IF p_click.fbc IS NOT NULL OR p_click.fbp IS NOT NULL OR p_click.fbclid IS NOT NULL THEN
    PERFORM public.upsert_meta_attribution(
      p_real_phone, p_click.fbc, p_click.fbp, NULL, p_click.fbclid,
      p_click.created_at, NULL, p_click.referer, 'live_whatsapp_link', p_click.lead_id);
    IF p_click.entered_phone IS NOT NULL
       AND public.live_zap_phone_key(p_click.entered_phone) IS DISTINCT FROM public.live_zap_phone_key(p_real_phone) THEN
      PERFORM public.upsert_meta_attribution(
        p_click.entered_phone, p_click.fbc, p_click.fbp, NULL, p_click.fbclid,
        p_click.created_at, NULL, p_click.referer, 'live_whatsapp_link', p_click.lead_id);
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

  -- Lead provisório recebe o nome do contato do WhatsApp
  IF p_click.lead_id IS NOT NULL THEN
    SELECT coalesce(nullif(trim(cc.custom_name), ''), nullif(trim(cc.display_name), ''))
      INTO v_name
      FROM public.chat_contacts cc
     WHERE public.live_zap_phone_key(cc.phone) = public.live_zap_phone_key(p_real_phone)
     ORDER BY (cc.custom_name IS NOT NULL) DESC, cc.updated_at DESC
     LIMIT 1;
    UPDATE public.event_leads
       SET name = coalesce(v_name, name),
           metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('live_whatsapp_link_real_phone', p_real_phone, 'live_whatsapp_link_matched_at', now())
     WHERE id = p_click.lead_id
       AND (name = 'Lead WhatsApp' OR name IS NULL OR name = '');
  END IF;
END;
$$;