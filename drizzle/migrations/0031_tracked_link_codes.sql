CREATE TABLE public.tracked_link_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  slug text NOT NULL,
  phone text NOT NULL,
  whatsapp_number_id uuid,
  source text,
  source_ref text,
  sent_count int NOT NULL DEFAULT 1,
  last_sent_at timestamptz NOT NULL DEFAULT now(),
  click_count int NOT NULL DEFAULT 0,
  first_clicked_at timestamptz,
  last_clicked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (slug, phone)
);
GRANT SELECT ON public.tracked_link_codes TO authenticated;
GRANT ALL ON public.tracked_link_codes TO service_role;
ALTER TABLE public.tracked_link_codes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff read tracked links" ON public.tracked_link_codes FOR SELECT TO authenticated USING (true);
CREATE INDEX tracked_link_codes_phone_idx ON public.tracked_link_codes (phone);

CREATE OR REPLACE FUNCTION public.tracked_link_issue(p_phone text, p_slug text, p_source text, p_ref text, p_number uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_code text; v_phone text := regexp_replace(coalesce(p_phone,''), '\D', '', 'g'); i int := 0;
BEGIN
  IF v_phone = '' OR coalesce(p_slug,'') = '' THEN RETURN NULL; END IF;
  UPDATE tracked_link_codes SET sent_count = sent_count + 1, last_sent_at = now(),
    source = coalesce(p_source, source), source_ref = coalesce(p_ref, source_ref),
    whatsapp_number_id = coalesce(p_number, whatsapp_number_id)
  WHERE slug = p_slug AND phone = v_phone RETURNING code INTO v_code;
  IF v_code IS NOT NULL THEN RETURN v_code; END IF;
  LOOP
    i := i + 1;
    v_code := upper(substr(translate(encode(gen_random_bytes(6),'base64'),'+/=0O1IL','ABCDEFGH'),1,6));
    BEGIN
      INSERT INTO tracked_link_codes (code, slug, phone, whatsapp_number_id, source, source_ref)
      VALUES (v_code, p_slug, v_phone, p_number, p_source, p_ref);
      RETURN v_code;
    EXCEPTION WHEN unique_violation THEN
      SELECT code INTO v_code FROM tracked_link_codes WHERE slug = p_slug AND phone = v_phone;
      IF v_code IS NOT NULL THEN RETURN v_code; END IF;
      IF i > 5 THEN RAISE; END IF;
    END;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.tracked_link_click(p_slug text, p_code text)
RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE tracked_link_codes SET click_count = click_count + 1,
    first_clicked_at = coalesce(first_clicked_at, now()), last_clicked_at = now()
  WHERE code = upper(p_code) AND slug = p_slug RETURNING phone;
$$;

CREATE OR REPLACE FUNCTION public.tracked_link_stats(p_slug text)
RETURNS TABLE(sent bigint, clicked bigint, clicks bigint) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT count(*), count(*) FILTER (WHERE click_count > 0), coalesce(sum(click_count),0)
  FROM tracked_link_codes WHERE slug = p_slug;
$$;
REVOKE ALL ON FUNCTION public.tracked_link_issue(text,text,text,text,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tracked_link_click(text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tracked_link_issue(text,text,text,text,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.tracked_link_click(text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.tracked_link_stats(text) TO authenticated, service_role;