BEGIN;
DO $$
DECLARE
  vaga uuid := gen_random_uuid();
  link uuid := gen_random_uuid();
  candidato uuid;
  resultado jsonb;
BEGIN
  INSERT INTO public.rh_vagas(id, titulo, resumo)
  VALUES(vaga, 'Teste condições — descartar', 'R$ 1.850,00 fixo + comissão + bônus · escala 5x2 · dias de live e sábados de live: trabalho até as 19h');
  INSERT INTO public.rh_links(id, code, instagram_username, vaga_id, estado)
  VALUES(link, 'teste' || left(replace(gen_random_uuid()::text, '-', ''), 12), 'teste_condicoes_' || left(replace(gen_random_uuid()::text, '-', ''), 10), vaga, 'aberto');

  SELECT public.rh_public_submit(
    (SELECT code FROM public.rh_links WHERE id = link),
    '{"nome":"Teste Condições","whatsapp":"5533999999999","idade":25,"bairro":"Centro","cidade":"Governador Valadares","transporte":"a_pe","aceita_condicoes":true,"ja_trabalhou":false,"experiencias":[],"computador":"nunca","situacao":"Situação fictícia para teste transacional.","respostas":{},"dispositivo":"computador"}'::jsonb
  ) INTO resultado;
  candidato := (resultado->>'candidato_id')::uuid;

  IF NOT EXISTS (
    SELECT 1 FROM public.rh_candidatos
    WHERE id = candidato AND condicoes_versao = '1850-live-sab-19h'
  ) THEN
    RAISE EXCEPTION 'A versão das condições não foi registrada no novo envio';
  END IF;
END $$;
ROLLBACK;
