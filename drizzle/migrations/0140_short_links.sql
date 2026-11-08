CREATE TABLE public.short_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE CHECK (code ~ '^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{5}$'),
  target_path text NOT NULL UNIQUE CHECK (left(target_path,1)='/' AND position('//' in target_path)=0 AND target_path !~* 'https?:' AND target_path !~ '[\\\s]'),
  label text, campaign_id uuid, draft_batch text,
  created_by uuid DEFAULT auth.uid(),
  click_count integer NOT NULL DEFAULT 0,
  first_clicked_at timestamptz, last_clicked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz
);
GRANT SELECT, INSERT ON public.short_links TO authenticated;
GRANT ALL ON public.short_links TO service_role;
ALTER TABLE public.short_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Equipe lê links curtos" ON public.short_links FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = auth.uid()));
CREATE POLICY "Equipe cria links curtos" ON public.short_links FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = auth.uid()));

CREATE OR REPLACE FUNCTION public.create_short_link(p_target_path text, p_label text DEFAULT NULL, p_draft_batch text DEFAULT NULL, p_campaign_id uuid DEFAULT NULL)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_code text; v_alpha text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; i int; tries int := 0;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid()) THEN
    RAISE EXCEPTION 'sem permissão';
  END IF;
  p_target_path := btrim(coalesce(p_target_path,''));
  IF left(p_target_path,1) <> '/' OR position('//' in p_target_path) > 0 OR p_target_path ~* 'https?:' OR p_target_path ~ '[\\\s]' THEN
    RAISE EXCEPTION 'caminho inválido: use um caminho relativo começando com /';
  END IF;
  SELECT code INTO v_code FROM short_links WHERE target_path = p_target_path;
  IF v_code IS NOT NULL THEN RETURN v_code; END IF;
  LOOP
    v_code := '';
    FOR i IN 1..5 LOOP v_code := v_code || substr(v_alpha, 1 + floor(random()*length(v_alpha))::int, 1); END LOOP;
    BEGIN
      INSERT INTO short_links(code, target_path, label, draft_batch, campaign_id, created_by)
      VALUES (v_code, p_target_path, p_label, p_draft_batch, p_campaign_id, auth.uid());
      RETURN v_code;
    EXCEPTION WHEN unique_violation THEN
      SELECT code INTO v_code FROM short_links WHERE target_path = p_target_path;
      IF v_code IS NOT NULL THEN RETURN v_code; END IF;
      tries := tries + 1; IF tries > 20 THEN RAISE EXCEPTION 'não foi possível gerar código'; END IF;
    END;
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.create_short_link(text,text,text,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_short_link(text,text,text,uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.resolve_short_link(p_code text)
RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE short_links SET click_count = click_count + 1,
    first_clicked_at = coalesce(first_clicked_at, now()), last_clicked_at = now()
  WHERE code = upper(btrim(p_code)) AND (expires_at IS NULL OR expires_at > now())
  RETURNING target_path;
$$;
REVOKE ALL ON FUNCTION public.resolve_short_link(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_short_link(text) TO anon, authenticated, service_role;