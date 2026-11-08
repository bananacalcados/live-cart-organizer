CREATE TABLE public.ig_comment_moderation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  comment_id text NOT NULL UNIQUE,
  ig_account_id text,
  media_id text,
  media_permalink text,
  media_thumb text,
  media_caption text,
  media_product_type text,
  from_id text,
  username text,
  text_original text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','classified','hidden','kept','failed','skipped')),
  skip_reason text,
  attempts integer NOT NULL DEFAULT 0,
  class text CHECK (class IS NULL OR class IN ('pedido_rastreio','acusacao','ofensa_spam','duvida','neutro_positivo')),
  ai_class_raw text,
  confidence numeric,
  reason text,
  ai_model text,
  classified_at timestamptz,
  hidden_at timestamptz,
  hide_response text,
  private_reply_sent_at timestamptz,
  private_reply_error text,
  suggested_reply text,
  public_reply_sent_at timestamptz,
  public_reply_by uuid,
  unhidden_at timestamptz,
  unhidden_by uuid,
  review_verdict text CHECK (review_verdict IS NULL OR review_verdict IN ('correct','wrong')),
  reviewed_by uuid,
  reviewed_at timestamptz,
  customer_id uuid,
  customer_name text,
  customer_phone text,
  contact_status text CHECK (contact_status IS NULL OR contact_status IN ('a_contatar','contatado','resolvido')),
  contact_note text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ig_comment_moderation_status_idx ON public.ig_comment_moderation (status, received_at);
CREATE INDEX ig_comment_moderation_class_idx ON public.ig_comment_moderation (class, hidden_at DESC);
CREATE INDEX ig_comment_moderation_contact_idx ON public.ig_comment_moderation (contact_status, received_at DESC) WHERE contact_status IS NOT NULL;
GRANT SELECT ON public.ig_comment_moderation TO authenticated;
GRANT ALL ON public.ig_comment_moderation TO service_role;
ALTER TABLE public.ig_comment_moderation ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff read comment moderation" ON public.ig_comment_moderation FOR SELECT TO authenticated USING (true);

CREATE TABLE public.ig_moderation_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  enabled boolean NOT NULL DEFAULT false,
  class_enabled jsonb NOT NULL DEFAULT '{"pedido_rastreio":true,"acusacao":true,"ofensa_spam":true,"duvida":true}'::jsonb,
  acusacao_min_confidence numeric NOT NULL DEFAULT 0.85,
  private_reply_template text NOT NULL DEFAULT 'Oi, {primeiro_nome}! Vi seu comentário sobre o seu pedido 💛 Me manda aqui seu CPF ou o número do pedido que eu te passo o rastreio na hora.',
  private_reply_tracking_suffix text NOT NULL DEFAULT 'Já deixo aqui o acompanhamento do seu último pedido: {link_rastreio}',
  public_reply_template text NOT NULL DEFAULT 'Oi! Todos os nossos produtos são originais, saem com nota fiscal e têm garantia 💛 Qualquer dúvida chama a gente no direct!',
  own_usernames text[] NOT NULL DEFAULT ARRAY['bananacalcados']::text[],
  team_usernames text[] NOT NULL DEFAULT ARRAY[]::text[],
  paused_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, UPDATE ON public.ig_moderation_settings TO authenticated;
GRANT ALL ON public.ig_moderation_settings TO service_role;
ALTER TABLE public.ig_moderation_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff read moderation settings" ON public.ig_moderation_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins update moderation settings" ON public.ig_moderation_settings FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
INSERT INTO public.ig_moderation_settings (id) VALUES (true) ON CONFLICT DO NOTHING;

CREATE TABLE public.ig_moderation_daily (
  day date NOT NULL,
  class text NOT NULL,
  hidden integer NOT NULL DEFAULT 0,
  unhidden integer NOT NULL DEFAULT 0,
  confirmed integer NOT NULL DEFAULT 0,
  to_contact integer NOT NULL DEFAULT 0,
  PRIMARY KEY (day, class)
);
GRANT SELECT ON public.ig_moderation_daily TO authenticated;
GRANT ALL ON public.ig_moderation_daily TO service_role;
ALTER TABLE public.ig_moderation_daily ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff read moderation daily" ON public.ig_moderation_daily FOR SELECT TO authenticated USING (true);

CREATE OR REPLACE FUNCTION public.ig_moderation_daily_bump()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE d date; c text;
BEGIN
  NEW.updated_at := now();
  c := coalesce(NEW.class, 'sem_classe');
  IF NEW.hidden_at IS NOT NULL AND OLD.hidden_at IS NULL THEN
    d := (NEW.hidden_at AT TIME ZONE 'America/Sao_Paulo')::date;
    INSERT INTO ig_moderation_daily(day,class,hidden) VALUES (d,c,1)
      ON CONFLICT (day,class) DO UPDATE SET hidden = ig_moderation_daily.hidden + 1;
  END IF;
  IF NEW.hidden_at IS NOT NULL AND (NEW.review_verdict IS DISTINCT FROM OLD.review_verdict) THEN
    d := (NEW.hidden_at AT TIME ZONE 'America/Sao_Paulo')::date;
    INSERT INTO ig_moderation_daily(day,class) VALUES (d,c) ON CONFLICT DO NOTHING;
    UPDATE ig_moderation_daily SET
      unhidden = unhidden + (CASE WHEN NEW.review_verdict='wrong' THEN 1 ELSE 0 END) - (CASE WHEN OLD.review_verdict='wrong' THEN 1 ELSE 0 END),
      confirmed = confirmed + (CASE WHEN NEW.review_verdict='correct' THEN 1 ELSE 0 END) - (CASE WHEN OLD.review_verdict='correct' THEN 1 ELSE 0 END)
    WHERE day = d AND class = c;
  END IF;
  IF (NEW.contact_status = 'a_contatar') IS DISTINCT FROM (OLD.contact_status = 'a_contatar') THEN
    d := (NEW.received_at AT TIME ZONE 'America/Sao_Paulo')::date;
    INSERT INTO ig_moderation_daily(day,class) VALUES (d,c) ON CONFLICT DO NOTHING;
    UPDATE ig_moderation_daily SET to_contact = greatest(0, to_contact + CASE WHEN NEW.contact_status='a_contatar' THEN 1 ELSE -1 END)
    WHERE day = d AND class = c;
  END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.ig_moderation_daily_bump() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_ig_moderation_daily BEFORE UPDATE ON public.ig_comment_moderation
  FOR EACH ROW WHEN (OLD.hidden_at IS DISTINCT FROM NEW.hidden_at OR OLD.review_verdict IS DISTINCT FROM NEW.review_verdict
    OR OLD.contact_status IS DISTINCT FROM NEW.contact_status OR OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.ig_moderation_daily_bump();

CREATE OR REPLACE FUNCTION public.ig_moderation_claim(p_limit integer DEFAULT 30)
RETURNS SETOF public.ig_comment_moderation LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE ig_comment_moderation m SET status = 'processing', attempts = attempts + 1
  WHERE m.id IN (
    SELECT id FROM ig_comment_moderation
    WHERE (status = 'pending' OR (status = 'processing' AND updated_at < now() - interval '15 minutes'))
      AND attempts < 3
    ORDER BY received_at LIMIT least(greatest(p_limit,1),50)
    FOR UPDATE SKIP LOCKED)
  RETURNING m.*;
$$;
REVOKE EXECUTE ON FUNCTION public.ig_moderation_claim(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ig_moderation_claim(integer) TO service_role;

CREATE OR REPLACE FUNCTION public.ig_moderation_summary()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN auth.uid() IS NULL THEN NULL ELSE jsonb_build_object(
    'hidden_24h', (SELECT count(*) FROM ig_comment_moderation WHERE hidden_at > now() - interval '24 hours'),
    'to_contact', (SELECT count(*) FROM ig_comment_moderation WHERE contact_status = 'a_contatar'),
    'doubts_open', (SELECT count(*) FROM ig_comment_moderation WHERE class = 'duvida' AND public_reply_sent_at IS NULL AND status = 'kept' AND received_at > now() - interval '30 days'),
    'reviewed', (SELECT coalesce(sum(unhidden + confirmed),0) FROM ig_moderation_daily WHERE day > current_date - 30),
    'unhidden', (SELECT coalesce(sum(unhidden),0) FROM ig_moderation_daily WHERE day > current_date - 30),
    'daily', (SELECT coalesce(jsonb_agg(jsonb_build_object('day',day,'class',class,'hidden',hidden,'unhidden',unhidden,'to_contact',to_contact) ORDER BY day DESC, class),'[]'::jsonb)
              FROM ig_moderation_daily WHERE day > current_date - 7)
  ) END
$$;
REVOKE EXECUTE ON FUNCTION public.ig_moderation_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ig_moderation_summary() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.ig_moderation_list(p_tab text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0, p_search text DEFAULT NULL)
RETURNS SETOF public.ig_comment_moderation LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT * FROM ig_comment_moderation m
  WHERE auth.uid() IS NOT NULL
    AND CASE p_tab
      WHEN 'ocultados' THEN m.hidden_at IS NOT NULL
      WHEN 'contatar' THEN m.contact_status IS NOT NULL
      WHEN 'duvidas' THEN m.class = 'duvida' AND m.status = 'kept'
      ELSE true END
    AND (p_search IS NULL OR p_search = '' OR m.username ILIKE '%'||p_search||'%')
  ORDER BY CASE WHEN p_tab = 'contatar' THEN (m.contact_status = 'resolvido')::int ELSE 0 END, m.received_at DESC
  LIMIT least(greatest(coalesce(p_limit,50),1),200) OFFSET greatest(coalesce(p_offset,0),0)
$$;
REVOKE EXECUTE ON FUNCTION public.ig_moderation_list(text,integer,integer,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ig_moderation_list(text,integer,integer,text) TO authenticated, service_role;