ALTER TABLE public.rh_candidatos ADD COLUMN IF NOT EXISTS condicoes_versao text;
COMMENT ON COLUMN public.rh_candidatos.condicoes_versao IS 'Versão das condições exibida no envio; NULL identifica cadastros anteriores.';

CREATE OR REPLACE FUNCTION public.rh_public_submit(p_code text, p_data jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  l rh_links%ROWTYPE;
  cid uuid;
  e jsonb;
  n int := 0;
  v_resumo text;
  v_salary text;
  v_hour text;
  v_version text;
BEGIN
  SELECT * INTO l FROM rh_links WHERE code = p_code FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'not_found'); END IF;
  IF l.estado = 'enviado' THEN RETURN jsonb_build_object('ok', false, 'error', 'submitted'); END IF;
  SELECT resumo INTO v_resumo FROM public.rh_vagas WHERE id = l.vaga_id;
  v_salary := substring(v_resumo from 'R\$[[:space:]]*([0-9.]+)');
  v_hour := substring(v_resumo from '([0-9]{1,2})[[:space:]]*h');
  v_version := NULLIF(concat_ws('-',
    NULLIF(replace(coalesce(v_salary, ''), '.', ''), ''),
    CASE WHEN v_resumo ~* 'live' THEN 'live' END,
    CASE WHEN v_resumo ~* 's[áa]bado' THEN 'sab' END,
    CASE WHEN v_hour IS NOT NULL THEN v_hour || 'h' END
  ), '');
  INSERT INTO rh_candidatos(link_id, vaga_id, instagram_username) VALUES (l.id, l.vaga_id, l.instagram_username)
  ON CONFLICT (link_id) DO NOTHING;
  UPDATE rh_candidatos SET
    nome = p_data->>'nome', whatsapp = p_data->>'whatsapp', idade = (p_data->>'idade')::int,
    bairro = p_data->>'bairro', cidade = p_data->>'cidade', transporte = p_data->>'transporte',
    aceita_condicoes = (p_data->>'aceita_condicoes')::boolean, ja_trabalhou = (p_data->>'ja_trabalhou')::boolean,
    computador = p_data->>'computador', situacao = p_data->>'situacao', dispositivo = p_data->>'dispositivo',
    condicoes_versao = left(coalesce(v_version, v_resumo, ''), 200),
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

CREATE OR REPLACE FUNCTION public.rh_list_candidatos(p_search text DEFAULT NULL,p_status text DEFAULT NULL,p_limit int DEFAULT 50,p_offset int DEFAULT 0) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$ DECLARE q text := left(trim(coalesce(p_search,'')),120); BEGIN IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'Sem permissão'; END IF; RETURN coalesce((SELECT jsonb_agg(x ORDER BY x.nao_topa,x.nota DESC NULLS LAST,x.created_at DESC,x.id) FROM (SELECT c.id,coalesce(c.nome,c.rascunho->>'nome','Sem nome') nome,c.instagram_username,coalesce(c.whatsapp,c.rascunho->>'whatsapp') whatsapp,coalesce(c.bairro,c.rascunho->>'bairro') bairro,coalesce(c.transporte,c.rascunho->>'transporte') transporte,coalesce(c.status,'incompleto') status,c.observacao,c.condicoes_versao,(c.aceita_condicoes IS FALSE) nao_topa,a.nota,a.parcial,a.evaluating,a.detalhe->'permanencia'->>'media_meses' media_meses,c.created_at FROM rh_candidatos c LEFT JOIN rh_avaliacoes a ON a.candidato_id=c.id WHERE (q='' OR lower(coalesce(c.nome,c.rascunho->>'nome','') || ' ' || c.instagram_username) LIKE '%' || lower(replace(replace(replace(q,'\','\\'),'%','\%'),'_','\_')) || '%') AND (p_status IS NULL OR coalesce(c.status,'incompleto')=p_status) ORDER BY (c.aceita_condicoes IS FALSE),a.nota DESC NULLS LAST,c.created_at DESC,c.id LIMIT least(greatest(coalesce(p_limit,50),1),200) OFFSET greatest(coalesce(p_offset,0),0)) x),'[]'); END $$;

REVOKE ALL ON FUNCTION public.rh_public_submit(text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rh_public_submit(text,jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.rh_list_candidatos(text,text,int,int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rh_list_candidatos(text,text,int,int) TO authenticated, service_role;