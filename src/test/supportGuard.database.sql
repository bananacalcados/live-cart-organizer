-- Run with the managed database query tool. Everything is rolled back; no provider is called
-- (the outbox only sends from the edge worker, which never sees these uncommitted rows).
BEGIN;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
DO $$
DECLARE
  x uuid := '0833dc6c-6bd4-4b2f-8cb2-1889a5993e9c';
  y uuid := '1f715932-e118-4e88-8051-85a5c14f5a4b';
  o uuid; got uuid[]; s record;
BEGIN
  DELETE FROM public.support_channel_pauses WHERE true;
  UPDATE public.support_outbox SET available_at=now()+interval '1 day' WHERE status='pending';
  UPDATE public.support_settings SET auto_reply_mode='auto', shadow_auto=false WHERE id=true;

  -- 1 falha não derruba o geral e manda a conversa para Em suporte
  INSERT INTO public.support_outbox(phone,whatsapp_number_id,text,requested_by,idempotency_key) VALUES('5533900000001',x,'t','assistant_auto','guard-t1') RETURNING id INTO o;
  UPDATE public.support_outbox SET status='failed', error='HTTP 502 <html>' WHERE id=o;
  IF (SELECT auto_reply_mode FROM public.support_settings) <> 'auto' THEN RAISE EXCEPTION '1 falha derrubou o modo geral'; END IF;
  IF EXISTS(SELECT 1 FROM public.support_channel_pauses) THEN RAISE EXCEPTION '1 falha pausou o canal'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.chat_conversation_lanes WHERE phone_key='00000001' AND whatsapp_number_id=x::text AND lane='support') THEN RAISE EXCEPTION 'conversa não foi para Em suporte'; END IF;

  -- janela de 24h não conta como falha do canal
  INSERT INTO public.support_outbox(phone,whatsapp_number_id,text,requested_by,idempotency_key,status,error) VALUES('5533900000009',x,'t','assistant_auto','guard-tw','pending',NULL) RETURNING id INTO o;
  UPDATE public.support_outbox SET status='failed', error='Fora da janela de 24 horas da Meta' WHERE id=o;

  -- 3 falhas no mesmo canal pausam só aquele canal
  INSERT INTO public.support_outbox(phone,whatsapp_number_id,text,requested_by,idempotency_key) VALUES('5533900000002',x,'t','assistant_auto','guard-t2') RETURNING id INTO o;
  UPDATE public.support_outbox SET status='failed', error='erro 2' WHERE id=o;
  IF EXISTS(SELECT 1 FROM public.support_channel_pauses) THEN RAISE EXCEPTION 'pausou com 2 falhas (janela contou?)'; END IF;
  INSERT INTO public.support_outbox(phone,whatsapp_number_id,text,requested_by,idempotency_key) VALUES('5533900000003',x,'t','assistant_auto','guard-t3') RETURNING id INTO o;
  UPDATE public.support_outbox SET status='failed', error='erro 3' WHERE id=o;
  IF NOT EXISTS(SELECT 1 FROM public.support_channel_pauses WHERE whatsapp_number_id=x AND paused_until>now()+interval '14 minutes') THEN RAISE EXCEPTION '3 falhas não pausaram o canal por 15 min'; END IF;
  IF EXISTS(SELECT 1 FROM public.support_channel_pauses WHERE whatsapp_number_id<>x) THEN RAISE EXCEPTION 'pausou outro canal'; END IF;
  IF (SELECT auto_reply_mode FROM public.support_settings) <> 'auto' THEN RAISE EXCEPTION '3 falhas num canal derrubaram o geral'; END IF;

  -- canal pausado espera; o outro segue
  INSERT INTO public.support_outbox(phone,whatsapp_number_id,text,requested_by,idempotency_key) VALUES('5533900000004',x,'t','assistant_auto','guard-t4');
  INSERT INTO public.support_outbox(phone,whatsapp_number_id,text,requested_by,idempotency_key) VALUES('5533900000005',y,'t','assistant_auto','guard-t5');
  SELECT array_agg(whatsapp_number_id) INTO got FROM public.support_outbox_claim(30);
  IF got IS DISTINCT FROM ARRAY[y] THEN RAISE EXCEPTION 'claim com canal pausado errado: %', got; END IF;

  -- sombra manual: shadow_auto=false; Central sai mesmo assim, IA não
  UPDATE public.support_settings SET auto_reply_mode='shadow' WHERE id=true;
  IF (SELECT shadow_auto FROM public.support_settings) THEN RAISE EXCEPTION 'sombra manual marcada como automática'; END IF;
  INSERT INTO public.support_outbox(phone,whatsapp_number_id,text,requested_by,idempotency_key) VALUES('5533900000006',y,'t','central_auto','guard-t6');
  INSERT INTO public.support_outbox(phone,whatsapp_number_id,text,requested_by,idempotency_key) VALUES('5533900000007',y,'t','assistant_auto','guard-t7');
  IF (SELECT array_agg(requested_by ORDER BY requested_by) FROM public.support_outbox_claim(30)) IS DISTINCT FROM ARRAY['central_auto'] THEN RAISE EXCEPTION 'Central presa na sombra ou IA saiu em sombra'; END IF;
  IF public.support_guard_recover((SELECT shadow_at FROM public.support_settings)) THEN RAISE EXCEPTION 'volta automática mexeu em sombra manual'; END IF;

  -- trava automática: marcada e recuperável
  UPDATE public.support_settings SET auto_reply_mode='auto' WHERE id=true;
  PERFORM public.support_emergency_pause('Falha de teste');
  SELECT * INTO s FROM public.support_settings;
  IF s.auto_reply_mode<>'shadow' OR NOT s.shadow_auto THEN RAISE EXCEPTION 'trava automática não marcada'; END IF;
  IF NOT public.support_guard_recover(s.shadow_at) THEN RAISE EXCEPTION 'não recuperou'; END IF;
  IF (SELECT auto_reply_mode FROM public.support_settings) <> 'auto' THEN RAISE EXCEPTION 'não voltou para auto'; END IF;

  -- teste após a pausa: uma falha no período de prova pausa de novo
  UPDATE public.support_channel_pauses SET paused_until=now()-interval '1 minute' WHERE whatsapp_number_id=x;
  UPDATE public.support_outbox SET created_at=now()-interval '1 hour' WHERE idempotency_key LIKE 'guard-t%';
  INSERT INTO public.support_outbox(phone,whatsapp_number_id,text,requested_by,idempotency_key) VALUES('5533900000008',x,'t','assistant_auto','guard-t8') RETURNING id INTO o;
  UPDATE public.support_outbox SET status='failed', error='de novo' WHERE id=o;
  IF NOT EXISTS(SELECT 1 FROM public.support_channel_pauses WHERE whatsapp_number_id=x AND paused_until>now()) THEN RAISE EXCEPTION 'falha no teste pós-pausa não pausou'; END IF;

  -- duas instâncias pausadas ao mesmo tempo => trava geral automática
  INSERT INTO public.support_channel_pauses(whatsapp_number_id,paused_until,reason) VALUES(y,now()-interval '1 minute','prova');
  INSERT INTO public.support_outbox(phone,whatsapp_number_id,text,requested_by,idempotency_key) VALUES('5533900000010',y,'t','assistant_auto','guard-t10') RETURNING id INTO o;
  UPDATE public.support_outbox SET status='failed', error='de novo' WHERE id=o;
  IF NOT (SELECT auto_reply_mode='shadow' AND shadow_auto FROM public.support_settings) THEN RAISE EXCEPTION '2 canais pausados não travaram o geral'; END IF;
  RAISE NOTICE 'supportGuard: todos os testes passaram';
END $$;
ROLLBACK;
