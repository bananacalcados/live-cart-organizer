\set ON_ERROR_STOP 1
BEGIN;
CREATE SCHEMA IF NOT EXISTS public;
CREATE TABLE live_followup_settings(id boolean PRIMARY KEY, value jsonb, sender text DEFAULT 'v1');
INSERT INTO live_followup_settings VALUES(true,'{"enabled":true,"limits":{"interval_min":20,"interval_max":60,"hourly":80,"daily_customer":6}}');
CREATE TABLE live_followup_instances(whatsapp_number_id uuid PRIMARY KEY,next_send_at timestamptz,paused boolean DEFAULT false,reason text,consecutive_errors integer DEFAULT 0,last_message text);
CREATE TABLE live_followup_jobs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),event_id uuid,order_id uuid,customer_key text,phone text,whatsapp_number_id uuid,channel text DEFAULT 'whatsapp',type text,step integer DEFAULT 0,sequence_key text,variant integer,scheduled_at timestamptz,status text,reason text,claimed_at timestamptz,created_at timestamptz DEFAULT now(),button_expires_at timestamptz);
CREATE FUNCTION live_followup_priority(t text,s integer) RETURNS integer LANGUAGE sql AS $$ SELECT 0 $$;
CREATE FUNCTION live_followup_enabled(e uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
\ir ../../docs/database/20261128_live_followup_v2_functions.sql
DO $$
DECLARE a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); j live_followup_jobs; ja uuid; n integer;
BEGIN
  -- 1) envio incerto NÃO segura a instância no v2.
  INSERT INTO live_followup_jobs(whatsapp_number_id,customer_key,type,sequence_key,scheduled_at,status,claimed_at) VALUES(a,'k0','A','s0',now()-interval '5 min','uncertain',now()-interval '2 min');
  INSERT INTO live_followup_jobs(id,whatsapp_number_id,customer_key,type,sequence_key,scheduled_at,status) VALUES(gen_random_uuid(),a,'k1','A','s1',now()-interval '1 min','pending');
  SELECT * INTO j FROM live_followup_claim_one(a); IF j.id IS NULL THEN RAISE EXCEPTION 'case1: uncertain segurou a instância'; END IF; ja:=j.id;
  -- 2) ritmo anti-ban: a mesma instância não reserva a próxima antes do intervalo.
  INSERT INTO live_followup_jobs(whatsapp_number_id,customer_key,type,sequence_key,scheduled_at,status) VALUES(a,'k2','A','s2',now()-interval '1 min','pending');
  SELECT count(*) INTO n FROM live_followup_claim_one(a); IF n<>0 THEN RAISE EXCEPTION 'case2: ignorou o ritmo'; END IF;
  -- 3) outra instância não é afetada.
  INSERT INTO live_followup_jobs(whatsapp_number_id,customer_key,type,sequence_key,scheduled_at,status) VALUES(b,'k3','A','s3',now()-interval '1 min','pending');
  SELECT count(*) INTO n FROM live_followup_claim_one(b); IF n<>1 THEN RAISE EXCEPTION 'case3: instância B atrasou'; END IF;
  -- 4) falha incerta no v2 marca para conferência sem pausar.
  PERFORM live_followup_failure_v2(ja,'provider_confirmation_missing',true);
  IF (SELECT status FROM live_followup_jobs WHERE id=ja)<>'uncertain' THEN RAISE EXCEPTION 'case4: status'; END IF;
  IF (SELECT paused FROM live_followup_instances WHERE whatsapp_number_id=a) THEN RAISE EXCEPTION 'case4: pausou a instância'; END IF;
  -- 5) D vencido há mais de 15 min continua pulando (late_step), como hoje.
  UPDATE live_followup_instances SET next_send_at=now()-interval '1 s';
  UPDATE live_followup_jobs SET status='sent' WHERE whatsapp_number_id=b AND status='processing';
  INSERT INTO live_followup_jobs(whatsapp_number_id,customer_key,type,sequence_key,scheduled_at,status) VALUES(b,'k4','D','s4',now()-interval '20 min','pending');
  PERFORM live_followup_claim_one(b);
  IF (SELECT reason FROM live_followup_jobs WHERE customer_key='k4')<>'late_step' THEN RAISE EXCEPTION 'case5: late_step'; END IF;
  -- 6) reserva presa >10 min é expirada sem reenviar e a fila segue.
  UPDATE live_followup_jobs SET status='processing',claimed_at=now()-interval '11 min' WHERE customer_key='k2';
  UPDATE live_followup_instances SET next_send_at=now()-interval '1 s';
  INSERT INTO live_followup_jobs(whatsapp_number_id,customer_key,type,sequence_key,scheduled_at,status) VALUES(a,'k5','A','s5',now()-interval '1 min','pending');
  SELECT * INTO j FROM live_followup_claim_one(a);
  IF (SELECT reason FROM live_followup_jobs WHERE customer_key='k2')<>'processing_expirado' OR j.customer_key<>'k5' THEN RAISE EXCEPTION 'case6: retomada'; END IF;
  RAISE NOTICE 'PASS live_followup v2 claim/failure';
END $$;
ROLLBACK;
