-- Simulação (sempre desfeita no fim): todos os provedores falham 3x → pausa 10 min → volta sozinha; nenhuma pausa sem prazo.
DO $$
DECLARE r jsonb; u timestamptz; ok boolean;
BEGIN
  DELETE FROM public.support_ai_outages; -- só dentro desta transação de teste
  r := public.support_ai_outage_record(NULL, 'teste 1'); IF (r->>'paused')::boolean THEN RAISE EXCEPTION 'FALHOU: pausou na 1a falha'; END IF;
  r := public.support_ai_outage_record(NULL, 'teste 2'); IF (r->>'paused')::boolean THEN RAISE EXCEPTION 'FALHOU: pausou na 2a falha'; END IF;
  r := public.support_ai_outage_record(NULL, 'teste 3');
  IF NOT (r->>'new')::boolean THEN RAISE EXCEPTION 'FALHOU: 3a falha não pausou %', r; END IF;
  SELECT ai_pause_until INTO u FROM public.support_settings;
  IF u IS NULL OR u > now()+interval '10 minutes 1 second' OR u < now()+interval '9 minutes' THEN RAISE EXCEPTION 'FALHOU: prazo %', u; END IF;
  r := public.support_cost_reserve(NULL,'1',NULL,'triagem','openai/gpt-6-luna',100);
  IF (r->>'allowed')::boolean OR r->>'reason' NOT LIKE 'ia_pausada_10min%' THEN RAISE EXCEPTION 'FALHOU: reserva durante a pausa %', r; END IF;
  r := public.support_ai_outage_record(NULL, 'teste 4'); IF (r->>'new')::boolean THEN RAISE EXCEPTION 'FALHOU: alerta duplicado'; END IF;
  -- passa o prazo: volta sozinha
  UPDATE public.support_settings SET ai_pause_until = now()-interval '1 second';
  r := public.support_cost_reserve(NULL,'1',NULL,'triagem','claude-haiku-4-5',100);
  IF NOT (r->>'allowed')::boolean THEN RAISE EXCEPTION 'FALHOU: não voltou após o prazo %', r; END IF;
  IF (SELECT provider FROM public.support_ai_calls WHERE id=(r->>'id')::uuid) <> 'anthropic' THEN RAISE EXCEPTION 'FALHOU: provedor não registrado'; END IF;
  -- depois da pausa, falhas antigas não re-pausam
  r := public.support_ai_outage_record(NULL, 'teste 5'); IF (r->>'paused')::boolean THEN RAISE EXCEPTION 'FALHOU: re-pausou com falhas antigas'; END IF;
  -- pausa sem prazo é impossível
  PERFORM public.support_cost_pause('qualquer', NULL);
  SELECT ai_pause_until IS NOT NULL AND ai_pause_until <= now()+interval '10 minutes 1 second' INTO ok FROM public.support_settings;
  IF NOT ok THEN RAISE EXCEPTION 'FALHOU: support_cost_pause sem prazo'; END IF;
  BEGIN
    UPDATE public.support_settings SET ai_pause_reason='x', ai_pause_until=NULL; RAISE EXCEPTION 'FALHOU: banco aceitou pausa sem prazo';
  EXCEPTION WHEN check_violation THEN NULL; END;
  RAISE EXCEPTION 'TESTE_OK (tudo desfeito)';
END $$;
