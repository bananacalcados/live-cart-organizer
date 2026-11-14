\set ON_ERROR_STOP 1
BEGIN;
\ir fixtures/liveFollowupPostpone.sql
\ir ../../docs/database/20261114190400_live_followup_postpone_ignore_confirm.sql
DO $$
DECLARE n uuid:=gen_random_uuid(); j1 uuid:=gen_random_uuid(); j2 uuid:=gen_random_uuid(); m uuid:=gen_random_uuid(); r jsonb;
BEGIN
  -- Case 1: only incoming message is the automatic registration confirmation => send.
  INSERT INTO live_followup_jobs(id,status,phone,whatsapp_number_id,channel,customer_key,event_id,sequence_key,step,scheduled_at)
   VALUES(j1,'processing','5533999990001',n,'whatsapp','k1',gen_random_uuid(),'s1',1,now());
  INSERT INTO whatsapp_messages VALUES(m,'5533999990001',n,'incoming',now()-interval '2 minutes',NULL,'já preenchi meu cadastro #ABC',NULL,NULL);
  INSERT INTO live_selfservice_accesses(confirm_message_id) VALUES(m);
  r:=live_followup_postpone(j1);
  IF r->>'action'<>'send' THEN RAISE EXCEPTION 'case1 expected send, got %',r; END IF;
  -- Case 2: real later message without manual reply => postponed customer_waiting.
  INSERT INTO live_followup_jobs(id,status,phone,whatsapp_number_id,channel,customer_key,event_id,sequence_key,step,scheduled_at)
   VALUES(j2,'processing','5533999990002',n,'whatsapp','k2',gen_random_uuid(),'s2',1,now());
  m:=gen_random_uuid();
  INSERT INTO whatsapp_messages VALUES(m,'5533999990002',n,'incoming',now()-interval '3 minutes',NULL,'já preenchi meu cadastro #DEF',NULL,NULL);
  INSERT INTO live_selfservice_accesses(confirm_message_id) VALUES(m);
  INSERT INTO whatsapp_messages VALUES(gen_random_uuid(),'5533999990002',n,'incoming',now()-interval '1 minute',NULL,'qual o frete?',NULL,NULL);
  r:=live_followup_postpone(j2);
  IF r->>'action'<>'postponed' OR r->>'why'<>'customer_waiting' THEN RAISE EXCEPTION 'case2 expected postponed/customer_waiting, got %',r; END IF;
  RAISE NOTICE 'PASS live_followup_postpone ignores registration confirmation';
END $$;
ROLLBACK;
DO $$ BEGIN IF to_regclass('public.live_followup_jobs') IS NOT NULL THEN RAISE EXCEPTION 'rollback failed'; END IF; END $$;
