CREATE TABLE public.rh_vagas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  titulo text NOT NULL,
  resumo text NOT NULL DEFAULT '',
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.rh_settings (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  guia_atendimento text NOT NULL DEFAULT '',
  pesos jsonb NOT NULL DEFAULT '{"atendimento":50,"situacao":20,"permanencia":15,"transporte":10,"computador":5}',
  faixas_permanencia jsonb NOT NULL DEFAULT '[{"ate_meses":3,"pontos":4},{"ate_meses":6,"pontos":8},{"ate_meses":12,"pontos":12},{"ate_meses":null,"pontos":15}]',
  pontos_sem_experiencia numeric NOT NULL DEFAULT 7.5,
  pontos_transporte jsonb NOT NULL DEFAULT '{"a_pe":6,"moto":6,"bicicleta":6,"carro":5,"onibus":3}',
  pontos_bairro_max numeric NOT NULL DEFAULT 4,
  teto_transporte numeric NOT NULL DEFAULT 10,
  pontos_computador jsonb NOT NULL DEFAULT '{"nunca":0,"um_pouco":3,"bem":5}',
  aviso_numero text NOT NULL DEFAULT '5533991955003',
  aviso_instancia_id uuid,
  aviso_ativo boolean NOT NULL DEFAULT false,
  palavra_chave text NOT NULL DEFAULT 'VAGA',
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

CREATE TABLE public.rh_cenarios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vaga_id uuid NOT NULL REFERENCES public.rh_vagas(id) ON DELETE CASCADE,
  ordem int NOT NULL DEFAULT 1,
  contexto text,
  mensagem_cliente text NOT NULL,
  gabarito text NOT NULL DEFAULT '',
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX rh_cenarios_vaga_idx ON public.rh_cenarios(vaga_id, ordem);

CREATE TABLE public.rh_bairros_proximos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  loja text NOT NULL CHECK (loja IN ('perola','centro')),
  bairro text NOT NULL,
  bairro_norm text NOT NULL,
  pontos numeric NOT NULL DEFAULT 4,
  UNIQUE (loja, bairro_norm)
);

CREATE TABLE public.rh_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  instagram_username text NOT NULL,
  vaga_id uuid NOT NULL REFERENCES public.rh_vagas(id),
  estado text NOT NULL DEFAULT 'gerado' CHECK (estado IN ('gerado','aberto','enviado')),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  opened_at timestamptz,
  submitted_at timestamptz,
  UNIQUE (instagram_username, vaga_id)
);
CREATE INDEX rh_links_created_idx ON public.rh_links(created_at DESC);

CREATE TABLE public.rh_candidatos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  link_id uuid NOT NULL UNIQUE REFERENCES public.rh_links(id) ON DELETE CASCADE,
  vaga_id uuid NOT NULL REFERENCES public.rh_vagas(id),
  instagram_username text NOT NULL,
  nome text, whatsapp text, idade int, bairro text, cidade text,
  transporte text CHECK (transporte IS NULL OR transporte IN ('a_pe','onibus','moto','bicicleta','carro')),
  aceita_condicoes boolean, ja_trabalhou boolean,
  computador text CHECK (computador IS NULL OR computador IN ('nunca','um_pouco','bem')),
  situacao text,
  dispositivo text,
  rascunho jsonb,
  rascunho_at timestamptz,
  status text CHECK (status IS NULL OR status IN ('novo','em_analise','chamado','aprovado','reprovado')),
  observacao text,
  consentimento_at timestamptz,
  submitted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX rh_candidatos_status_idx ON public.rh_candidatos(status, submitted_at DESC) WHERE submitted_at IS NOT NULL;

CREATE TABLE public.rh_experiencias (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidato_id uuid NOT NULL REFERENCES public.rh_candidatos(id) ON DELETE CASCADE,
  ordem int NOT NULL,
  onde text NOT NULL,
  funcao text NOT NULL,
  duracao_meses numeric NOT NULL CHECK (duracao_meses > 0)
);
CREATE INDEX rh_experiencias_cand_idx ON public.rh_experiencias(candidato_id);

CREATE TABLE public.rh_respostas_teste (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidato_id uuid NOT NULL REFERENCES public.rh_candidatos(id) ON DELETE CASCADE,
  cenario_id uuid REFERENCES public.rh_cenarios(id) ON DELETE SET NULL,
  ordem int NOT NULL,
  mensagem_cliente text NOT NULL,
  resposta text NOT NULL
);
CREATE INDEX rh_respostas_cand_idx ON public.rh_respostas_teste(candidato_id);

CREATE TABLE public.rh_avaliacoes (
  candidato_id uuid PRIMARY KEY REFERENCES public.rh_candidatos(id) ON DELETE CASCADE,
  nota numeric,
  parcial boolean NOT NULL DEFAULT true,
  detalhe jsonb,
  resumo_ia text,
  alertas jsonb,
  ai_attempted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX rh_avaliacoes_nota_idx ON public.rh_avaliacoes(nota DESC NULLS LAST);

CREATE TABLE public.rh_avisos (
  candidato_id uuid PRIMARY KEY REFERENCES public.rh_candidatos(id) ON DELETE CASCADE,
  estado text NOT NULL DEFAULT 'pendente' CHECK (estado IN ('pendente','enviando','enviado','falhou')),
  claimed_at timestamptz, sent_at timestamptz, erro text,
  reenvios int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.rh_vagas, public.rh_settings, public.rh_cenarios, public.rh_bairros_proximos TO authenticated;
GRANT SELECT ON public.rh_links, public.rh_candidatos, public.rh_experiencias, public.rh_respostas_teste, public.rh_avaliacoes, public.rh_avisos TO authenticated;
GRANT ALL ON public.rh_vagas, public.rh_settings, public.rh_cenarios, public.rh_bairros_proximos, public.rh_links, public.rh_candidatos,
  public.rh_experiencias, public.rh_respostas_teste, public.rh_avaliacoes, public.rh_avisos TO service_role;

ALTER TABLE public.rh_vagas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rh_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rh_cenarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rh_bairros_proximos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rh_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rh_candidatos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rh_experiencias ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rh_respostas_teste ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rh_avaliacoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rh_avisos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rh admin" ON public.rh_vagas FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE POLICY "rh admin" ON public.rh_settings FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE POLICY "rh admin" ON public.rh_cenarios FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE POLICY "rh admin" ON public.rh_bairros_proximos FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE POLICY "rh admin le" ON public.rh_links FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));
CREATE POLICY "rh admin le" ON public.rh_candidatos FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));
CREATE POLICY "rh admin le" ON public.rh_experiencias FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));
CREATE POLICY "rh admin le" ON public.rh_respostas_teste FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));
CREATE POLICY "rh admin le" ON public.rh_avaliacoes FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));
CREATE POLICY "rh admin le" ON public.rh_avisos FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));

CREATE INDEX IF NOT EXISTS security_events_rh_ip_idx ON public.security_events(ip, created_at) WHERE event = 'rh_public';
CREATE INDEX IF NOT EXISTS security_events_rh_code_idx ON public.security_events((details->>'code'), created_at) WHERE event = 'rh_public';

INSERT INTO public.rh_vagas (id, titulo, resumo) VALUES
 ('7b0c2a6e-4f1d-4e8a-9c3b-2d5e6f7a8b90', 'Vendedor(a) — Live e Lojas', 'R$ 1.950 fixo + comissão + bônus · escala 5x2 · sábado e dias de live até as 19h');

INSERT INTO public.rh_settings (id, guia_atendimento) VALUES (1,
'A) Toda resposta termina com uma pergunta que leve ao fechamento, ou avisando que voltamos em breve para ver se a compra deu certo.
B) Quando pedem fotos, primeiro passamos a faixa de preço e perguntamos a preferência, sem sair mandando fotos.
C) Se pedem foto de um produto que viram no anúncio, reenviamos o link do anúncio (lá estão as cores).
D) Pedido genérico (ex.: "quero ver bolsas") → valores médios primeiro, fotos de alguns modelos depois.
E) Se o cliente ignora nossa pergunta e faz outra, respondemos a dele e puxamos de volta para a nossa pergunta.
F) Frases curtas, sempre terminando com nova pergunta.');

INSERT INTO public.rh_cenarios (vaga_id, ordem, contexto, mensagem_cliente, gabarito) VALUES
 ('7b0c2a6e-4f1d-4e8a-9c3b-2d5e6f7a8b90', 1, NULL, 'Oi, quero ver bolsas', 'Passar a faixa de preço + pergunta de preferência, sem mandar foto ainda.'),
 ('7b0c2a6e-4f1d-4e8a-9c3b-2d5e6f7a8b90', 2, NULL, 'Vi o anúncio do tênis X, manda foto das cores', 'Reenviar o link do anúncio (o candidato escreve "link do anúncio" onde iria o link) + pergunta de fechamento.'),
 ('7b0c2a6e-4f1d-4e8a-9c3b-2d5e6f7a8b90', 3, 'Você perguntou ''Qual numeração você calça?''', 'Tem frete grátis pra BH?', 'Responder sobre o frete (sim ou a regra) e voltar a perguntar a numeração.');

-- Senha da área RH: mesmo mecanismo de Folha/Fiscal. Sem senha definida a área não abre;
-- o admin define a primeira senha pela tela (sem senha atual). Áreas com senha seguem exigindo a atual.
CREATE OR REPLACE FUNCTION public.change_area_password(p_area text, p_current text, p_new text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE h text; found_row boolean;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'Apenas administradores podem alterar a senha'; END IF;
  IF p_area NOT IN ('fiscal','folha','rh') THEN RAISE EXCEPTION 'Área inválida'; END IF;
  IF p_new IS NULL OR length(p_new) < 6 THEN RAISE EXCEPTION 'A nova senha precisa ter pelo menos 6 caracteres'; END IF;
  SELECT password_hash INTO h FROM public.fiscal_access_settings WHERE area=p_area FOR UPDATE;
  found_row := FOUND;
  IF found_row AND crypt(coalesce(p_current,''), h) <> h THEN RAISE EXCEPTION 'Senha atual incorreta'; END IF;
  IF found_row THEN
    UPDATE public.fiscal_access_settings SET password_hash = crypt(p_new, gen_salt('bf')), updated_at = now(), updated_by = auth.uid() WHERE area=p_area;
  ELSE
    INSERT INTO public.fiscal_access_settings(area, password_hash, updated_at, updated_by) VALUES (p_area, crypt(p_new, gen_salt('bf')), now(), auth.uid());
  END IF;
  RETURN true;
END $$;

CREATE OR REPLACE FUNCTION public.verify_area_password(p_area text, p_password text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE h text; k text := coalesce(auth.uid()::text, 'anon'); a public.fiscal_access_attempts%ROWTYPE;
BEGIN
  IF p_area NOT IN ('fiscal','folha','rh') THEN RETURN jsonb_build_object('ok',false,'error','area'); END IF;
  SELECT * INTO a FROM public.fiscal_access_attempts WHERE area=p_area AND user_key=k FOR UPDATE;
  IF FOUND AND a.locked_until IS NOT NULL AND a.locked_until > now() THEN
    RETURN jsonb_build_object('ok',false,'locked_until',a.locked_until);
  END IF;
  SELECT password_hash INTO h FROM public.fiscal_access_settings WHERE area=p_area;
  IF h IS NOT NULL AND p_password IS NOT NULL AND crypt(p_password, h) = h THEN
    DELETE FROM public.fiscal_access_attempts WHERE area=p_area AND user_key=k;
    RETURN jsonb_build_object('ok',true);
  END IF;
  INSERT INTO public.fiscal_access_attempts(area,user_key,failed_count) VALUES (p_area,k,1)
  ON CONFLICT (area,user_key) DO UPDATE SET
    failed_count = CASE WHEN fiscal_access_attempts.locked_until IS NOT NULL THEN 1 ELSE fiscal_access_attempts.failed_count + 1 END,
    locked_until = NULL, updated_at = now()
  RETURNING * INTO a;
  IF a.failed_count >= 5 THEN
    UPDATE public.fiscal_access_attempts SET locked_until = now() + interval '5 minutes' WHERE area=p_area AND user_key=k RETURNING * INTO a;
    RETURN jsonb_build_object('ok',false,'locked_until',a.locked_until);
  END IF;
  RETURN jsonb_build_object('ok',false,'remaining',5 - a.failed_count);
END $$;

CREATE OR REPLACE FUNCTION public.rh_area_password_set(p_area text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_role(auth.uid(),'admin') AND EXISTS (SELECT 1 FROM fiscal_access_settings WHERE area = p_area AND password_hash IS NOT NULL);
$$;

CREATE OR REPLACE FUNCTION public.rh_norm_username(p text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT nullif(left(regexp_replace(lower(coalesce(p,'')), '[^a-z0-9._]', '', 'g'), 30), '');
$$;

CREATE OR REPLACE FUNCTION public.rh_create_link(p_username text, p_vaga_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE u text := public.rh_norm_username(p_username); r public.rh_links%ROWTYPE; c text; i int; b bytea;
  alpha text := 'abcdefghjkmnpqrstuvwxyz23456789';
BEGIN
  IF u IS NULL THEN RAISE EXCEPTION 'Instagram inválido'; END IF;
  IF NOT EXISTS (SELECT 1 FROM rh_vagas WHERE id = p_vaga_id AND ativo) THEN RAISE EXCEPTION 'Vaga inválida'; END IF;
  SELECT * INTO r FROM rh_links WHERE instagram_username = u AND vaga_id = p_vaga_id;
  IF FOUND THEN RETURN jsonb_build_object('id', r.id, 'code', r.code, 'username', u, 'reused', true, 'estado', r.estado); END IF;
  FOR attempt IN 1..10 LOOP
    b := gen_random_bytes(12); c := '';
    FOR i IN 0..11 LOOP c := c || substr(alpha, 1 + (get_byte(b, i) % length(alpha)), 1); END LOOP;
    BEGIN
      INSERT INTO rh_links(code, instagram_username, vaga_id, created_by) VALUES (c, u, p_vaga_id, auth.uid()) RETURNING * INTO r;
      RETURN jsonb_build_object('id', r.id, 'code', r.code, 'username', u, 'reused', false, 'estado', r.estado);
    EXCEPTION WHEN unique_violation THEN
      SELECT * INTO r FROM rh_links WHERE instagram_username = u AND vaga_id = p_vaga_id;
      IF FOUND THEN RETURN jsonb_build_object('id', r.id, 'code', r.code, 'username', u, 'reused', true, 'estado', r.estado); END IF;
    END;
  END LOOP;
  RAISE EXCEPTION 'Não foi possível gerar o código';
END $$;

CREATE OR REPLACE FUNCTION public.rh_admin_create_link(p_username text, p_vaga_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'Sem permissão'; END IF;
  RETURN public.rh_create_link(p_username, p_vaga_id);
END $$;

CREATE OR REPLACE FUNCTION public.rh_list_links(p_estado text DEFAULT NULL, p_limit int DEFAULT 50, p_offset int DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'Sem permissão'; END IF;
  RETURN coalesce((SELECT jsonb_agg(x ORDER BY x.created_at DESC) FROM (
    SELECT l.id, l.code, l.instagram_username, l.estado, l.created_at, l.opened_at, l.submitted_at, v.titulo AS vaga
    FROM rh_links l JOIN rh_vagas v ON v.id = l.vaga_id
    WHERE p_estado IS NULL OR l.estado = p_estado
    ORDER BY l.created_at DESC
    LIMIT least(greatest(coalesce(p_limit,50),1),200) OFFSET greatest(coalesce(p_offset,0),0)) x), '[]'::jsonb);
END $$;

CREATE OR REPLACE FUNCTION public.rh_counts()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'Sem permissão'; END IF;
  RETURN (SELECT jsonb_build_object(
    'novos', (SELECT count(*) FROM rh_candidatos WHERE status = 'novo' AND submitted_at IS NOT NULL),
    'enviados', (SELECT count(*) FROM rh_links WHERE estado = 'enviado'),
    'abertos', (SELECT count(*) FROM rh_links WHERE estado = 'aberto'),
    'gerados', (SELECT count(*) FROM rh_links WHERE estado = 'gerado')));
END $$;

CREATE OR REPLACE FUNCTION public.rh_delete_candidato(p_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'Sem permissão'; END IF;
  DELETE FROM rh_candidatos WHERE id = p_id;
  RETURN FOUND;
END $$;

CREATE OR REPLACE FUNCTION public.rh_public_hit(p_ip text, p_code text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n_ip int; n_code int;
BEGIN
  SELECT count(*) INTO n_ip FROM security_events WHERE event = 'rh_public' AND ip = p_ip AND created_at > now() - interval '1 hour';
  SELECT count(*) INTO n_code FROM security_events WHERE event = 'rh_public' AND details->>'code' = p_code AND created_at > now() - interval '1 hour';
  IF (p_ip IS NOT NULL AND n_ip >= 30) OR n_code >= 60 THEN RETURN false; END IF;
  INSERT INTO security_events(event, ip, details) VALUES ('rh_public', p_ip, jsonb_build_object('code', p_code));
  RETURN true;
END $$;

CREATE OR REPLACE FUNCTION public.rh_public_open(p_code text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE l rh_links%ROWTYPE; d jsonb;
BEGIN
  SELECT * INTO l FROM rh_links WHERE code = p_code FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('found', false); END IF;
  IF l.estado = 'enviado' THEN RETURN jsonb_build_object('found', true, 'submitted', true, 'username', l.instagram_username); END IF;
  IF l.estado = 'gerado' THEN UPDATE rh_links SET estado = 'aberto', opened_at = now() WHERE id = l.id; END IF;
  SELECT rascunho INTO d FROM rh_candidatos WHERE link_id = l.id;
  RETURN jsonb_build_object('found', true, 'submitted', false, 'username', l.instagram_username, 'draft', d,
    'vaga', (SELECT jsonb_build_object('titulo', titulo, 'resumo', resumo) FROM rh_vagas WHERE id = l.vaga_id),
    'guia', (SELECT guia_atendimento FROM rh_settings WHERE id = 1),
    'cenarios', coalesce((SELECT jsonb_agg(jsonb_build_object('id', id, 'contexto', contexto, 'mensagem', mensagem_cliente) ORDER BY ordem)
       FROM rh_cenarios WHERE vaga_id = l.vaga_id AND ativo), '[]'::jsonb));
END $$;

CREATE OR REPLACE FUNCTION public.rh_public_draft(p_code text, p_draft jsonb)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE l rh_links%ROWTYPE;
BEGIN
  SELECT * INTO l FROM rh_links WHERE code = p_code;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;
  IF l.estado = 'enviado' THEN RETURN 'submitted'; END IF;
  INSERT INTO rh_candidatos(link_id, vaga_id, instagram_username, rascunho, rascunho_at)
  VALUES (l.id, l.vaga_id, l.instagram_username, p_draft, now())
  ON CONFLICT (link_id) DO UPDATE SET rascunho = EXCLUDED.rascunho, rascunho_at = now(), updated_at = now()
  WHERE rh_candidatos.rascunho IS DISTINCT FROM EXCLUDED.rascunho AND rh_candidatos.submitted_at IS NULL;
  RETURN 'ok';
END $$;

CREATE OR REPLACE FUNCTION public.rh_public_submit(p_code text, p_data jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE l rh_links%ROWTYPE; cid uuid; e jsonb; n int := 0;
BEGIN
  SELECT * INTO l FROM rh_links WHERE code = p_code FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'not_found'); END IF;
  IF l.estado = 'enviado' THEN RETURN jsonb_build_object('ok', false, 'error', 'submitted'); END IF;
  INSERT INTO rh_candidatos(link_id, vaga_id, instagram_username) VALUES (l.id, l.vaga_id, l.instagram_username)
  ON CONFLICT (link_id) DO NOTHING;
  UPDATE rh_candidatos SET
    nome = p_data->>'nome', whatsapp = p_data->>'whatsapp', idade = (p_data->>'idade')::int,
    bairro = p_data->>'bairro', cidade = p_data->>'cidade', transporte = p_data->>'transporte',
    aceita_condicoes = (p_data->>'aceita_condicoes')::boolean, ja_trabalhou = (p_data->>'ja_trabalhou')::boolean,
    computador = p_data->>'computador', situacao = p_data->>'situacao', dispositivo = p_data->>'dispositivo',
    status = 'novo', consentimento_at = now(), submitted_at = now(), rascunho = NULL, updated_at = now()
  WHERE link_id = l.id RETURNING id INTO cid;
  DELETE FROM rh_experiencias WHERE candidato_id = cid;
  DELETE FROM rh_respostas_teste WHERE candidato_id = cid;
  FOR e IN SELECT * FROM jsonb_array_elements(coalesce(p_data->'experiencias','[]'::jsonb)) LOOP
    n := n + 1;
    INSERT INTO rh_experiencias(candidato_id, ordem, onde, funcao, duracao_meses)
    VALUES (cid, n, e->>'onde', e->>'funcao', (e->>'duracao_meses')::numeric);
  END LOOP;
  INSERT INTO rh_respostas_teste(candidato_id, cenario_id, ordem, mensagem_cliente, resposta)
  SELECT cid, c.id, c.ordem, c.mensagem_cliente, p_data->'respostas'->>(c.id::text)
  FROM rh_cenarios c WHERE c.vaga_id = l.vaga_id AND c.ativo;
  UPDATE rh_links SET estado = 'enviado', submitted_at = now(), opened_at = coalesce(opened_at, now()) WHERE id = l.id;
  RETURN jsonb_build_object('ok', true, 'candidato_id', cid);
END $$;

REVOKE ALL ON FUNCTION public.rh_create_link(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rh_create_link(text, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.rh_public_hit(text,text), public.rh_public_open(text), public.rh_public_draft(text,jsonb), public.rh_public_submit(text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rh_public_hit(text,text), public.rh_public_open(text), public.rh_public_draft(text,jsonb), public.rh_public_submit(text,jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.rh_admin_create_link(text,uuid), public.rh_list_links(text,int,int), public.rh_counts(), public.rh_delete_candidato(uuid), public.rh_area_password_set(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rh_admin_create_link(text,uuid), public.rh_list_links(text,int,int), public.rh_counts(), public.rh_delete_candidato(uuid), public.rh_area_password_set(text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.rh_norm_username(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rh_norm_username(text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.change_area_password(text,text,text), public.verify_area_password(text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.change_area_password(text,text,text), public.verify_area_password(text,text) TO authenticated, service_role;