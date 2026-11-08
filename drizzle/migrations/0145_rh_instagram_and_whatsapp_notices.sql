ALTER TABLE public.ig_live_cart_notifications
  ADD COLUMN IF NOT EXISTS source_key text,
  ADD COLUMN IF NOT EXISTS comment_id text,
  ADD COLUMN IF NOT EXISTS recipient_id text,
  ADD COLUMN IF NOT EXISTS instagram_account_id text;

CREATE UNIQUE INDEX IF NOT EXISTS ig_live_cart_notifications_rh_vaga_source_key
  ON public.ig_live_cart_notifications (source_key, instagram_handle)
  WHERE kind = 'rh_vaga_link' AND source_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS instagram_comment_rules_one_rh_vaga
  ON public.instagram_comment_rules (trigger_type)
  WHERE trigger_type = 'rh_vaga';

ALTER TABLE public.rh_avisos
  ADD COLUMN IF NOT EXISTS claim_token uuid,
  ADD COLUMN IF NOT EXISTS provider_message_id text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.rh_settings
  ADD COLUMN IF NOT EXISTS aviso_ultimo_status text,
  ADD COLUMN IF NOT EXISTS aviso_ultimo_erro text,
  ADD COLUMN IF NOT EXISTS aviso_ultimo_at timestamptz,
  ADD COLUMN IF NOT EXISTS aviso_ultimo_tipo text;

CREATE OR REPLACE FUNCTION public.rh_aviso_claim(p_id uuid, p_manual boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_c record;
  v_s public.rh_settings%ROWTYPE;
  v_a public.rh_avisos%ROWTYPE;
  v_token uuid := gen_random_uuid();
BEGIN
  SELECT c.id, c.nome, c.idade, c.bairro, a.nota, a.parcial
    INTO v_c
  FROM public.rh_candidatos c
  JOIN public.rh_avaliacoes a ON a.candidato_id = c.id
  WHERE c.id = p_id
    AND c.submitted_at IS NOT NULL
    AND a.ai_attempted_at IS NOT NULL
    AND NOT a.evaluating
    AND a.nota IS NOT NULL;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'message', 'A avaliação ainda não terminou.');
  END IF;

  SELECT * INTO v_s FROM public.rh_settings WHERE id = 1;
  IF NOT p_manual AND NOT COALESCE(v_s.aviso_ativo, false) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'disabled', 'message', 'Aviso desligado.');
  END IF;
  IF v_s.aviso_instancia_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Escolha a instância uazapi nas configurações do RH.');
  END IF;
  IF COALESCE(v_s.aviso_numero, '') !~ '^55[1-9]{2}9?[0-9]{8}$' THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Número do aviso inválido.');
  END IF;

  INSERT INTO public.rh_avisos(candidato_id) VALUES (p_id) ON CONFLICT DO NOTHING;
  SELECT * INTO v_a FROM public.rh_avisos WHERE candidato_id = p_id FOR UPDATE;

  IF v_a.estado = 'enviando' THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Já existe um aviso em andamento.');
  END IF;
  IF NOT p_manual AND (v_a.claimed_at IS NOT NULL OR v_a.sent_at IS NOT NULL OR v_a.estado <> 'pendente') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_claimed', 'message', 'O aviso automático já foi reservado.');
  END IF;
  IF p_manual AND v_a.reenvios >= 3 THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Limite de 3 envios manuais atingido.');
  END IF;

  UPDATE public.rh_avisos
  SET estado = 'enviando',
      claimed_at = now(),
      sent_at = CASE WHEN p_manual THEN NULL ELSE sent_at END,
      erro = NULL,
      claim_token = v_token,
      reenvios = reenvios + CASE WHEN p_manual THEN 1 ELSE 0 END,
      updated_at = now()
  WHERE candidato_id = p_id;

  RETURN jsonb_build_object(
    'ok', true,
    'token', v_token,
    'candidato_id', p_id,
    'nome', v_c.nome,
    'idade', v_c.idade,
    'bairro', v_c.bairro,
    'nota', v_c.nota,
    'parcial', v_c.parcial,
    'aviso_numero', v_s.aviso_numero,
    'aviso_instancia_id', v_s.aviso_instancia_id
  );
END
$function$;

CREATE OR REPLACE FUNCTION public.rh_aviso_finish(
  p_id uuid,
  p_token uuid,
  p_ok boolean,
  p_error text DEFAULT NULL,
  p_provider_message_id text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.rh_avisos
  SET estado = CASE WHEN p_ok THEN 'enviado' ELSE 'falhou' END,
      sent_at = CASE WHEN p_ok THEN now() ELSE sent_at END,
      erro = CASE WHEN p_ok THEN NULL ELSE left(COALESCE(p_error, 'Falha no envio'), 900) END,
      provider_message_id = COALESCE(p_provider_message_id, provider_message_id),
      claim_token = NULL,
      updated_at = now()
  WHERE candidato_id = p_id
    AND claim_token = p_token
    AND estado = 'enviando';
  IF NOT FOUND THEN RETURN false; END IF;

  UPDATE public.rh_settings
  SET aviso_ultimo_status = CASE WHEN p_ok THEN 'enviado' ELSE 'falhou' END,
      aviso_ultimo_erro = CASE WHEN p_ok THEN NULL ELSE left(COALESCE(p_error, 'Falha no envio'), 900) END,
      aviso_ultimo_at = now(),
      aviso_ultimo_tipo = 'candidato'
  WHERE id = 1;
  RETURN true;
END
$function$;

REVOKE ALL ON FUNCTION public.rh_aviso_claim(uuid, boolean) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.rh_aviso_finish(uuid, uuid, boolean, text, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rh_aviso_claim(uuid, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.rh_aviso_finish(uuid, uuid, boolean, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.rh_admin_context()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'Sem permissão'; END IF;
  RETURN jsonb_build_object(
    'password_set', public.rh_area_password_set('rh'),
    'counts', public.rh_counts(),
    'vagas', (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'titulo', titulo, 'resumo', resumo) ORDER BY created_at), '[]') FROM public.rh_vagas WHERE ativo),
    'automacao', (SELECT jsonb_build_object('found', true, 'active', r.is_active, 'name', r.name, 'media_types', r.media_types, 'cooldown_minutes', r.cooldown_minutes)
                  FROM public.instagram_comment_rules r WHERE r.trigger_type = 'rh_vaga' ORDER BY r.created_at DESC LIMIT 1),
    'aviso', (SELECT jsonb_build_object('active', s.aviso_ativo, 'instance_selected', s.aviso_instancia_id IS NOT NULL,
              'last_status', s.aviso_ultimo_status, 'last_error', s.aviso_ultimo_erro,
              'last_at', s.aviso_ultimo_at, 'last_type', s.aviso_ultimo_tipo)
              FROM public.rh_settings s WHERE s.id = 1)
  );
END
$function$;

CREATE OR REPLACE FUNCTION public.rh_candidate_detail(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'Sem permissão'; END IF;
  RETURN (
    SELECT jsonb_build_object(
      'password_set', public.rh_area_password_set('rh'),
      'candidato', to_jsonb(c),
      'experiencias', COALESCE((SELECT jsonb_agg(to_jsonb(e) ORDER BY e.ordem) FROM public.rh_experiencias e WHERE e.candidato_id = c.id), '[]'),
      'respostas', COALESCE((SELECT jsonb_agg(jsonb_build_object('ordem', r.ordem, 'mensagem_cliente', r.mensagem_cliente, 'resposta', r.resposta, 'contexto', s.contexto) ORDER BY r.ordem)
                            FROM public.rh_respostas_teste r LEFT JOIN public.rh_cenarios s ON s.id = r.cenario_id WHERE r.candidato_id = c.id), '[]'),
      'avaliacao', (SELECT to_jsonb(a) - 'claim_token' FROM public.rh_avaliacoes a WHERE a.candidato_id = c.id),
      'aviso', (SELECT to_jsonb(n) - 'claim_token' FROM public.rh_avisos n WHERE n.candidato_id = c.id)
    )
    FROM public.rh_candidatos c WHERE c.id = p_id
  );
END
$function$;

REVOKE ALL ON FUNCTION public.rh_admin_context() FROM public, anon;
REVOKE ALL ON FUNCTION public.rh_candidate_detail(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.rh_admin_context() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rh_candidate_detail(uuid) TO authenticated, service_role;
