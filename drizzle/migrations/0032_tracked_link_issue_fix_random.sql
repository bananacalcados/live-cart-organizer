CREATE OR REPLACE FUNCTION public.tracked_link_issue(p_phone text, p_slug text, p_source text, p_ref text, p_number uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_code text; v_phone text := regexp_replace(coalesce(p_phone,''), '\D', '', 'g'); i int := 0;
  alphabet text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; j int;
BEGIN
  IF v_phone = '' OR coalesce(p_slug,'') = '' THEN RETURN NULL; END IF;
  UPDATE tracked_link_codes SET sent_count = sent_count + 1, last_sent_at = now(),
    source = coalesce(p_source, source), source_ref = coalesce(p_ref, source_ref),
    whatsapp_number_id = coalesce(p_number, whatsapp_number_id)
  WHERE slug = p_slug AND phone = v_phone RETURNING code INTO v_code;
  IF v_code IS NOT NULL THEN RETURN v_code; END IF;
  LOOP
    i := i + 1;
    v_code := '';
    FOR j IN 1..6 LOOP
      v_code := v_code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    END LOOP;
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