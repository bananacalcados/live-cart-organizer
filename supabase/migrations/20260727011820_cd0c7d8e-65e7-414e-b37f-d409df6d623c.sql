CREATE TABLE public.meta_attribution_identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone text NOT NULL UNIQUE,
  fbc text,
  fbp text,
  ctwa_clid text,
  fbclid text,
  click_time timestamptz,
  ad_id text,
  source_url text,
  origin text,
  lead_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '90 days')
);

CREATE INDEX idx_meta_attr_lead ON public.meta_attribution_identities(lead_id);
CREATE INDEX idx_meta_attr_expires ON public.meta_attribution_identities(expires_at);

GRANT ALL ON public.meta_attribution_identities TO service_role;

ALTER TABLE public.meta_attribution_identities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "meta_attr_service_only" ON public.meta_attribution_identities
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Upsert com regra de merge: nunca degrada um sinal existente.
CREATE OR REPLACE FUNCTION public.upsert_meta_attribution(
  p_phone text,
  p_fbc text DEFAULT NULL,
  p_fbp text DEFAULT NULL,
  p_ctwa_clid text DEFAULT NULL,
  p_fbclid text DEFAULT NULL,
  p_click_time timestamptz DEFAULT NULL,
  p_ad_id text DEFAULT NULL,
  p_source_url text DEFAULT NULL,
  p_origin text DEFAULT NULL,
  p_lead_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_phone IS NULL OR length(p_phone) < 12 THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.meta_attribution_identities AS m (
    phone, fbc, fbp, ctwa_clid, fbclid, click_time, ad_id, source_url, origin, lead_id,
    first_seen_at, last_seen_at, expires_at
  ) VALUES (
    p_phone, p_fbc, p_fbp, p_ctwa_clid, p_fbclid, COALESCE(p_click_time, now()),
    p_ad_id, p_source_url, p_origin, p_lead_id, now(), now(), now() + interval '90 days'
  )
  ON CONFLICT (phone) DO UPDATE SET
    -- fbc novo só entra se existir; mais recente vence, nunca apaga o antigo
    fbc = CASE
            WHEN p_fbc IS NOT NULL AND p_fbc <> '' THEN p_fbc
            ELSE m.fbc
          END,
    fbp = COALESCE(NULLIF(m.fbp, ''), NULLIF(p_fbp, '')),
    ctwa_clid = CASE WHEN p_ctwa_clid IS NOT NULL AND p_ctwa_clid <> '' THEN p_ctwa_clid ELSE m.ctwa_clid END,
    fbclid = CASE WHEN p_fbclid IS NOT NULL AND p_fbclid <> '' THEN p_fbclid ELSE m.fbclid END,
    click_time = CASE
                   WHEN (p_fbc IS NOT NULL AND p_fbc <> '') OR (p_ctwa_clid IS NOT NULL AND p_ctwa_clid <> '')
                     THEN COALESCE(p_click_time, now())
                   ELSE m.click_time
                 END,
    ad_id = COALESCE(NULLIF(p_ad_id, ''), m.ad_id),
    source_url = COALESCE(NULLIF(p_source_url, ''), m.source_url),
    origin = COALESCE(NULLIF(p_origin, ''), m.origin),
    lead_id = COALESCE(p_lead_id, m.lead_id),
    last_seen_at = now(),
    expires_at = CASE
                   WHEN (p_fbc IS NOT NULL AND p_fbc <> '') OR (p_ctwa_clid IS NOT NULL AND p_ctwa_clid <> '')
                     THEN now() + interval '90 days'
                   ELSE m.expires_at
                 END
  RETURNING m.id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_meta_attribution(text,text,text,text,text,timestamptz,text,text,text,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_meta_attribution(text,text,text,text,text,timestamptz,text,text,text,uuid) TO service_role;