-- Motor "Link de Atendimento" dos Grupos VIP (independente da Live e do /vip)
ALTER TABLE public.group_campaign_scheduled_messages
  ADD COLUMN IF NOT EXISTS vip_link_mode text DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS vip_link_product jsonb;

CREATE TABLE public.vip_link_daily_destination (
  day date PRIMARY KEY,
  whatsapp_number_id uuid NOT NULL REFERENCES public.whatsapp_numbers(id),
  set_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.vip_link_daily_destination TO authenticated;
GRANT ALL ON public.vip_link_daily_destination TO service_role;
ALTER TABLE public.vip_link_daily_destination ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read vip dest" ON public.vip_link_daily_destination FOR SELECT TO authenticated USING (true);

CREATE TABLE public.vip_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  dispatch_id uuid UNIQUE REFERENCES public.group_campaign_block_dispatches(id) ON DELETE SET NULL,
  scheduled_message_id uuid,
  campaign_id uuid,
  group_db_id uuid,
  group_name text,
  mode text NOT NULL CHECK (mode IN ('product','general')),
  product jsonb,
  product_title text,
  dest_day date NOT NULL,
  message_text text NOT NULL,
  click_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX vip_links_group_idx ON public.vip_links(group_db_id);
CREATE INDEX vip_links_created_idx ON public.vip_links(created_at);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vip_links TO authenticated;
GRANT ALL ON public.vip_links TO service_role;
ALTER TABLE public.vip_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth all vip links" ON public.vip_links FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TABLE public.vip_link_clicks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  link_id uuid REFERENCES public.vip_links(id) ON DELETE CASCADE,
  code text,
  group_db_id uuid,
  campaign_id uuid,
  user_agent text,
  is_bot boolean NOT NULL DEFAULT false,
  dest_number_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX vip_link_clicks_link_idx ON public.vip_link_clicks(link_id);
CREATE INDEX vip_link_clicks_created_idx ON public.vip_link_clicks(created_at);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vip_link_clicks TO authenticated;
GRANT ALL ON public.vip_link_clicks TO service_role;
ALTER TABLE public.vip_link_clicks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth all vip clicks" ON public.vip_link_clicks FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TABLE public.vip_link_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  link_id uuid REFERENCES public.vip_links(id) ON DELETE SET NULL,
  phone text,
  phone_key text,
  group_db_id uuid,
  group_name text,
  campaign_id uuid,
  product_title text,
  product jsonb,
  whatsapp_number_id uuid,
  message_id uuid,
  match_method text NOT NULL CHECK (match_method IN ('code','member')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX vip_link_conv_phone_key_idx ON public.vip_link_conversations(phone_key);
CREATE INDEX vip_link_conv_group_idx ON public.vip_link_conversations(group_db_id);
CREATE INDEX vip_link_conv_created_idx ON public.vip_link_conversations(created_at);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vip_link_conversations TO authenticated;
GRANT ALL ON public.vip_link_conversations TO service_role;
ALTER TABLE public.vip_link_conversations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth all vip conv" ON public.vip_link_conversations FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Chave DDD + 8 últimos dígitos (própria deste motor)
CREATE OR REPLACE FUNCTION public.vip_link_phone_key(p_phone text)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE d text := regexp_replace(coalesce(p_phone,''), '\D', '', 'g');
BEGIN
  IF d = '' THEN RETURN NULL; END IF;
  IF d LIKE '55%' AND length(d) IN (12,13) THEN d := substr(d, 3); END IF;
  IF length(d) NOT IN (10,11) THEN RETURN NULL; END IF;
  RETURN left(d,2) || right(d,8);
END $$;

-- Trava do dia
CREATE OR REPLACE FUNCTION public.vip_set_daily_destination(p_day date, p_number_id uuid, p_force boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_cur uuid; v_label text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF p_day IS NULL OR p_number_id IS NULL THEN RAISE EXCEPTION 'Dia e instância são obrigatórios'; END IF;
  SELECT whatsapp_number_id INTO v_cur FROM vip_link_daily_destination WHERE day = p_day FOR UPDATE;
  IF v_cur IS NULL THEN
    INSERT INTO vip_link_daily_destination(day, whatsapp_number_id, set_by) VALUES (p_day, p_number_id, auth.uid());
    RETURN jsonb_build_object('ok', true, 'changed', true);
  END IF;
  IF v_cur = p_number_id THEN RETURN jsonb_build_object('ok', true, 'changed', false); END IF;
  IF p_force AND public.has_role(auth.uid(), 'admin') THEN
    UPDATE vip_link_daily_destination SET whatsapp_number_id = p_number_id, set_by = auth.uid(), updated_at = now() WHERE day = p_day;
    RETURN jsonb_build_object('ok', true, 'changed', true, 'forced', true);
  END IF;
  SELECT label INTO v_label FROM whatsapp_numbers WHERE id = v_cur;
  RAISE EXCEPTION 'Dia já travado na instância %', coalesce(v_label, v_cur::text);
END $$;
REVOKE ALL ON FUNCTION public.vip_set_daily_destination(date, uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.vip_set_daily_destination(date, uuid, boolean) TO authenticated;

-- Cria (idempotente) o link de um job grupo × bloco
CREATE OR REPLACE FUNCTION public.vip_link_get_or_create(p_dispatch_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_job group_campaign_block_dispatches%ROWTYPE;
  v_block group_campaign_scheduled_messages%ROWTYPE;
  v_code text; v_title text; v_text text; v_try int := 0;
  v_alpha text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_group text;
BEGIN
  SELECT code INTO v_code FROM vip_links WHERE dispatch_id = p_dispatch_id;
  IF v_code IS NOT NULL THEN RETURN v_code; END IF;
  SELECT * INTO v_job FROM group_campaign_block_dispatches WHERE id = p_dispatch_id;
  IF v_job.id IS NULL THEN RETURN NULL; END IF;
  IF v_job.message_group_id IS NOT NULL THEN
    SELECT * INTO v_block FROM group_campaign_scheduled_messages
     WHERE message_group_id = v_job.message_group_id AND block_order = v_job.block_order LIMIT 1;
  ELSE
    SELECT * INTO v_block FROM group_campaign_scheduled_messages WHERE id = v_job.scheduled_message_id;
  END IF;
  IF v_block.id IS NULL OR coalesce(v_block.vip_link_mode,'none') NOT IN ('product','general') THEN RETURN NULL; END IF;
  v_group := replace(coalesce(v_job.group_name, 'VIP'), '#', '');
  v_title := nullif(btrim(replace(coalesce(v_block.vip_link_product->>'title',''), '#', '')), '');
  LOOP
    v_try := v_try + 1;
    v_code := '';
    FOR i IN 1..6 LOOP
      v_code := v_code || substr(v_alpha, 1 + floor(random()*32)::int, 1);
    END LOOP;
    IF v_block.vip_link_mode = 'product' AND v_title IS NOT NULL THEN
      v_text := 'Oi! Quero este produto: ' || v_title || ' 🛍️ (Grupo: ' || v_group || ') VIP-' || v_code;
    ELSE
      v_text := 'Oi! Vim do grupo ' || v_group || ' e quero atendimento 😊 VIP-' || v_code;
    END IF;
    BEGIN
      INSERT INTO vip_links(code, dispatch_id, scheduled_message_id, campaign_id, group_db_id, group_name, mode, product, product_title, dest_day, message_text)
      VALUES (v_code, p_dispatch_id, v_block.id, v_job.campaign_id, v_job.group_db_id, v_job.group_name,
              CASE WHEN v_block.vip_link_mode = 'product' AND v_title IS NOT NULL THEN 'product' ELSE 'general' END,
              v_block.vip_link_product, v_title, (now() AT TIME ZONE 'America/Sao_Paulo')::date, v_text);
      RETURN v_code;
    EXCEPTION WHEN unique_violation THEN
      SELECT code INTO v_code FROM vip_links WHERE dispatch_id = p_dispatch_id;
      IF v_code IS NOT NULL THEN RETURN v_code; END IF;
      IF v_try > 8 THEN RAISE; END IF;
    END;
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.vip_link_get_or_create(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.vip_link_get_or_create(uuid) TO service_role;

-- Resolução do clique (1 consulta)
CREATE OR REPLACE FUNCTION public.vip_link_resolve(p_code text)
RETURNS TABLE(link_id uuid, message_text text, group_db_id uuid, campaign_id uuid, dest_number_id uuid, provider text, phone_display text, wasender_phone_number text, uazapi_owner text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT l.id, l.message_text, l.group_db_id, l.campaign_id, n.id, n.provider, n.phone_display, n.wasender_phone_number, n.uazapi_owner
    FROM vip_links l
    LEFT JOIN LATERAL (
      SELECT d.whatsapp_number_id FROM vip_link_daily_destination d
       WHERE d.day = l.dest_day
      UNION ALL
      SELECT * FROM (SELECT d2.whatsapp_number_id FROM vip_link_daily_destination d2 ORDER BY d2.day DESC LIMIT 1) x
      LIMIT 1
    ) dd ON true
    LEFT JOIN whatsapp_numbers n ON n.id = dd.whatsapp_number_id
   WHERE l.code = upper(p_code)
   LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.vip_link_resolve(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.vip_link_resolve(text) TO service_role;

CREATE OR REPLACE FUNCTION public.vip_link_register_click(p_link_id uuid, p_code text, p_group uuid, p_campaign uuid, p_ua text, p_is_bot boolean, p_dest uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO vip_link_clicks(link_id, code, group_db_id, campaign_id, user_agent, is_bot, dest_number_id)
  VALUES (p_link_id, upper(p_code), p_group, p_campaign, left(p_ua, 500), coalesce(p_is_bot,false), p_dest);
  IF NOT coalesce(p_is_bot,false) THEN
    UPDATE vip_links SET click_count = click_count + 1 WHERE id = p_link_id;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.vip_link_register_click(uuid, text, uuid, uuid, text, boolean, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.vip_link_register_click(uuid, text, uuid, uuid, text, boolean, uuid) TO service_role;

-- Identificação da conversa (trigger NOVO e separado)
CREATE OR REPLACE FUNCTION public.vip_link_match_incoming()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_msg text := coalesce(NEW.message, '');
  v_code text; v_link vip_links%ROWTYPE; v_key text;
  v_gid text; v_cnt int; v_group whatsapp_groups%ROWTYPE;
BEGIN
  BEGIN
    v_code := upper(substring(v_msg from '(?i)VIP-([A-HJ-NP-Z2-9]{6})'));
    IF v_code IS NULL AND v_msg !~ '^\s*Oi! (Quero este produto:|Vim do grupo)' THEN
      RETURN NEW;
    END IF;
    v_key := public.vip_link_phone_key(NEW.phone);
    IF v_code IS NOT NULL THEN
      SELECT * INTO v_link FROM vip_links WHERE code = v_code;
      IF v_link.id IS NOT NULL THEN
        INSERT INTO vip_link_conversations(link_id, phone, phone_key, group_db_id, group_name, campaign_id, product_title, product, whatsapp_number_id, message_id, match_method)
        VALUES (v_link.id, NEW.phone, v_key, v_link.group_db_id, v_link.group_name, v_link.campaign_id, v_link.product_title, v_link.product, NEW.whatsapp_number_id, NEW.id, 'code');
        RETURN NEW;
      END IF;
    END IF;
    IF v_key IS NULL OR v_msg !~ '^\s*Oi! (Quero este produto:|Vim do grupo)' THEN RETURN NEW; END IF;
    SELECT count(DISTINCT m.group_id), min(m.group_id) INTO v_cnt, v_gid
      FROM whatsapp_group_members m
     WHERE m.status = 'member' AND public.vip_link_phone_key(m.phone) = v_key;
    IF v_cnt = 1 THEN
      SELECT * INTO v_group FROM whatsapp_groups WHERE group_id = v_gid ORDER BY is_vip DESC NULLS LAST LIMIT 1;
      INSERT INTO vip_link_conversations(phone, phone_key, group_db_id, group_name, whatsapp_number_id, message_id, match_method)
      VALUES (NEW.phone, v_key, v_group.id, v_group.name, NEW.whatsapp_number_id, NEW.id, 'member');
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[vip_link_match_incoming] %', SQLERRM;
    RETURN NEW;
  END;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_vip_link_match_incoming
AFTER INSERT ON public.whatsapp_messages
FOR EACH ROW
WHEN (((new.direction)::text = 'incoming') AND (new.is_group IS NOT TRUE) AND (new.message IS NOT NULL) AND (new.message ~* '(VIP-[A-Z0-9]{6}|^\s*Oi! (Quero este produto:|Vim do grupo))'))
EXECUTE FUNCTION public.vip_link_match_incoming();

-- Painel por período (relatório da aba Links de atendimento)
CREATE OR REPLACE FUNCTION public.vip_link_stats(p_from timestamptz, p_to timestamptz)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH l AS (SELECT * FROM vip_links WHERE created_at >= p_from AND created_at < p_to),
  c AS (SELECT * FROM vip_link_clicks WHERE created_at >= p_from AND created_at < p_to AND NOT is_bot),
  v AS (SELECT * FROM vip_link_conversations WHERE created_at >= p_from AND created_at < p_to),
  g AS (
    SELECT coalesce(x.group_db_id::text, '-') gid, max(x.group_name) group_name,
           sum(x.links) links, sum(x.clicks) clicks, sum(x.convs) convs
    FROM (
      SELECT group_db_id, group_name, count(*) links, 0 clicks, 0 convs FROM l GROUP BY 1,2
      UNION ALL SELECT c.group_db_id, NULL, 0, count(*), 0 FROM c GROUP BY 1
      UNION ALL SELECT v.group_db_id, v.group_name, 0, 0, count(DISTINCT v.phone_key) FROM v GROUP BY 1,2
    ) x GROUP BY 1
  ),
  p AS (
    SELECT coalesce(x.t, '(sem produto)') product_title, sum(x.clicks) clicks, sum(x.convs) convs FROM (
      SELECT lk.product_title t, count(*) clicks, 0 convs FROM c JOIN vip_links lk ON lk.id = c.link_id GROUP BY 1
      UNION ALL SELECT v.product_title, 0, count(DISTINCT v.phone_key) FROM v GROUP BY 1
    ) x GROUP BY 1
  )
  SELECT jsonb_build_object(
    'groups', coalesce((SELECT jsonb_agg(to_jsonb(g) ORDER BY g.clicks DESC) FROM g), '[]'::jsonb),
    'products', coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.clicks DESC) FROM p), '[]'::jsonb)
  )
$$;
REVOKE ALL ON FUNCTION public.vip_link_stats(timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.vip_link_stats(timestamptz, timestamptz) TO authenticated;