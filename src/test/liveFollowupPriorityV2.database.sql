\set ON_ERROR_STOP 1
BEGIN;
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
-- Independent synthetic schema, never connected to production.
CREATE TABLE live_followup_settings(id boolean PRIMARY KEY,value jsonb,sender text DEFAULT 'v2');
INSERT INTO live_followup_settings VALUES(true,'{"enabled":true,"limits":{"interval_min":20,"interval_max":60,"hourly":80,"daily_customer":6}}');
CREATE TABLE live_followup_instances(whatsapp_number_id uuid PRIMARY KEY,next_send_at timestamptz,paused boolean DEFAULT false,reason text,consecutive_errors integer DEFAULT 0,last_message text);
CREATE TABLE live_followup_jobs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),event_id uuid,order_id uuid,customer_key text,phone text,whatsapp_number_id uuid,channel text DEFAULT 'whatsapp',type text,step integer DEFAULT 0,sequence_key text,variant integer,scheduled_at timestamptz,status text,reason text,claimed_at timestamptz,sent_at timestamptz,created_at timestamptz DEFAULT now(),button_expires_at timestamptz);
CREATE INDEX live_followup_jobs_due ON live_followup_jobs(scheduled_at,id) WHERE status='pending';
CREATE INDEX live_followup_jobs_instance_history ON live_followup_jobs(whatsapp_number_id,claimed_at DESC) WHERE claimed_at IS NOT NULL;
CREATE INDEX live_followup_jobs_customer_history ON live_followup_jobs(customer_key,claimed_at DESC) WHERE claimed_at IS NOT NULL;
CREATE INDEX live_followup_jobs_sequence ON live_followup_jobs(sequence_key,step);
CREATE FUNCTION live_followup_priority(t text,s integer) RETURNS integer LANGUAGE sql AS $$ SELECT CASE WHEN t IN ('A','B','C') OR (t='F' AND s=0) THEN 0 WHEN t='D' THEN least(greatest(s+1,1),3) WHEN t='F' THEN least(greatest(s,1),3) ELSE 4 END $$;
CREATE FUNCTION live_followup_enabled(e uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT e IS DISTINCT FROM 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid $$;
CREATE TABLE orders(event_id uuid,created_at timestamptz);
CREATE TABLE live_comments(created_at timestamptz);
\ir ../../docs/database/20261128_live_followup_v2_functions.sql
\ir ../../docs/followups/PRIORIDADE-V2.sql

DO $$ DECLARE j live_followup_jobs; a uuid:=gen_random_uuid(); BEGIN
  IF live_followup_priority('D',0)<>1 OR live_followup_priority('A',0)<>0 THEN RAISE EXCEPTION 'v1 changed'; END IF;
  IF live_followup_priority_v2('D',0)<>0 OR live_followup_priority_v2('A',0)<>1
    OR live_followup_priority_v2('B',0)<>1 OR live_followup_priority_v2('C',0)<>1
    OR live_followup_priority_v2('F',0)<>1 OR live_followup_priority_v2('E',0)<>5
    OR live_followup_priority_v2('D',1)<>6 OR live_followup_priority_v2('D',2)<>7 THEN RAISE EXCEPTION 'wrong priorities'; END IF;
  INSERT INTO live_followup_jobs(customer_key,whatsapp_number_id,type,step,sequence_key,scheduled_at,status) VALUES
    ('oldA',a,'A',0,'A',now()-interval '10 minutes','pending'),
    ('newD',a,'D',0,'D',now()-interval '1 minute','pending'),
    ('Dlate',a,'D',1,'Dl',now()-interval '16 minutes','pending');
  SELECT * INTO j FROM live_followup_claim_one(a);
  IF j.customer_key<>'newD' THEN RAISE EXCEPTION 'D first lost to older A'; END IF;
  IF (SELECT reason FROM live_followup_jobs WHERE customer_key='Dlate')<>'sem_folga_no_pico' THEN RAISE EXCEPTION 'missing congestion reason'; END IF;
  UPDATE live_followup_jobs SET status='sent' WHERE customer_key='newD';
  UPDATE live_followup_instances SET next_send_at=now()-interval '1 second';
  INSERT INTO live_followup_jobs(customer_key,whatsapp_number_id,type,step,sequence_key,scheduled_at,status) VALUES ('olderB',a,'B',0,'B',now()-interval '11 minutes','pending');
  SELECT * INTO j FROM live_followup_claim_one(a);
  IF j.customer_key<>'olderB' THEN RAISE EXCEPTION 'same priority not FIFO'; END IF;
  UPDATE live_followup_jobs SET status='sent';
  UPDATE live_followup_instances SET next_send_at=now()-interval '1 second';
  INSERT INTO live_followup_jobs(customer_key,whatsapp_number_id,type,step,sequence_key,scheduled_at,status) VALUES ('noPeak',a,'D',2,'np',now()-interval '16 minutes','pending');
  PERFORM live_followup_claim_one(a);
  IF (SELECT reason FROM live_followup_jobs WHERE customer_key='noPeak')<>'late_step' THEN RAISE EXCEPTION 'ordinary delay misclassified as peak'; END IF;
  INSERT INTO live_followup_jobs(customer_key,whatsapp_number_id,type,step,sequence_key,scheduled_at,status) VALUES
    ('futureF',a,'F',0,'blockedF',now()+interval '10 minutes','pending'),
    ('blockedF',a,'F',1,'blockedF',now()-interval '1 minute','pending'),
    ('secondary',a,'D',1,'secondary',now()-interval '1 minute','pending');
  SELECT * INTO j FROM live_followup_claim_one(a);
  IF j.id IS NOT NULL THEN RAISE EXCEPTION 'secondary D bypassed higher due job'; END IF;
  IF (SELECT reason FROM live_followup_jobs WHERE customer_key='secondary')<>'aguardando_folga' THEN RAISE EXCEPTION 'contention not remembered'; END IF;
  UPDATE live_followup_jobs SET status='cancelled' WHERE customer_key IN ('futureF','blockedF');
  SELECT * INTO j FROM live_followup_claim_one(a);
  IF j.customer_key<>'secondary' OR j.reason IS NOT NULL THEN RAISE EXCEPTION 'secondary D did not send with spare capacity'; END IF;
  UPDATE live_followup_jobs SET status='sent';
  UPDATE live_followup_instances SET next_send_at=now()-interval '1 second';
  INSERT INTO live_followup_jobs(customer_key,event_id,whatsapp_number_id,type,step,sequence_key,scheduled_at,status) VALUES
    ('disabled','ffffffff-ffff-ffff-ffff-ffffffffffff',a,'D',1,'disabled',now()-interval '16 minutes','pending');
  PERFORM live_followup_claim_one(a);
  IF (SELECT reason FROM live_followup_jobs WHERE customer_key='disabled')<>'event_disabled' THEN RAISE EXCEPTION 'event cancellation changed'; END IF;
  INSERT INTO live_followup_jobs(customer_key,whatsapp_number_id,type,step,sequence_key,scheduled_at,status,claimed_at)
    SELECT 'quota',a,'A',0,'quota'||n,now()-interval '20 minutes','sent',now()-interval '20 minutes' FROM generate_series(1,6) n;
  INSERT INTO live_followup_jobs(customer_key,whatsapp_number_id,type,step,sequence_key,scheduled_at,status) VALUES
    ('quota',a,'D',1,'quotaD',now()-interval '16 minutes','pending');
  PERFORM live_followup_claim_one(a);
  IF (SELECT reason FROM live_followup_jobs WHERE sequence_key='quotaD')<>'customer_daily_limit' THEN RAISE EXCEPTION 'daily limit precedence changed'; END IF;
  IF has_function_privilege('authenticated','live_followup_claim_one(uuid)','execute') OR has_function_privilege('anon','live_followup_priority_v2(text,integer)','execute') THEN RAISE EXCEPTION 'public claim'; END IF;
  RAISE NOTICE 'PASS priorities, v1 intact, FIFO, reasons, grants';
END $$;

-- Synthetic clock: run the real SQL claim unchanged except its time sources, never production.
CREATE TABLE test_clock(at timestamptz);
INSERT INTO test_clock VALUES('2026-11-28 15:00:00+00');
CREATE FUNCTION test_now() RETURNS timestamptz LANGUAGE sql STABLE AS $$ SELECT at FROM test_clock $$;
DO $$ DECLARE def text; BEGIN
  SELECT pg_get_functiondef('live_followup_claim_one(uuid)'::regprocedure) INTO def;
  EXECUTE replace(replace(def,'now()','public.test_now()'),'clock_timestamp()','public.test_now()');
END $$;
CREATE TABLE load_results(scenario text,instances integer,d_first_total integer,d_first_sent integer,d_first_max_minutes numeric,a integer,b integer,c integer,e integer,d_second_sent integer,d_third_sent integer,no_spare_second integer,no_spare_third integer,late_first integer,pending integer,max_claims_hour integer,a_first_hour integer,b_first_hour integer,c_first_hour integer,d_first_first_hour integer);

CREATE FUNCTION run_load(p_scenario text,p_instances integer,p_first integer,p_other integer,p_minutes integer DEFAULT 60)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE base timestamptz:='2026-11-28 15:00:00+00'; inst uuid; j live_followup_jobs; m integer; n integer; k integer; i integer; t text; st integer; due timestamptz; cursor_at timestamptz; next_at timestamptz;
BEGIN
  TRUNCATE live_followup_jobs,live_followup_instances;
  PERFORM setseed(0.42);
  -- One fixed number per synthetic live. Two-number scenario means two independent lives, never spreading one live.
  FOR n IN 1..p_first+p_other LOOP
    inst:=('00000000-0000-0000-0000-'||lpad((1+(n-1)%p_instances)::text,12,'0'))::uuid;
    st:=0;
    IF n<=p_first THEN t:='D';
    ELSE
      i:=n-p_first;
      IF p_other=225 THEN
        IF i<=40 THEN t:='A'; ELSIF i<=80 THEN t:='B'; ELSIF i<=115 THEN t:='C'; ELSIF i<=125 THEN t:='E'; ELSIF i<=175 THEN t:='D';st:=1; ELSE t:='D';st:=2; END IF;
      ELSE t:='A'; END IF;
    END IF;
    -- Uniform arrivals in the same hour; second/third D have an already-sent previous step.
    k:=CASE WHEN t='D' AND st=0 THEN n ELSE n-p_first END;
    due:=base+make_interval(secs=>floor((k-1)*p_minutes*60.0/CASE WHEN n<=p_first THEN p_first ELSE p_other END)::integer);
    INSERT INTO live_followup_jobs(customer_key,event_id,whatsapp_number_id,type,step,sequence_key,scheduled_at,status)
    VALUES('load'||n,inst,inst,t,st,'seq'||n,due,'pending');
    IF st>0 THEN INSERT INTO live_followup_jobs(customer_key,event_id,whatsapp_number_id,type,step,sequence_key,scheduled_at,status,sent_at)
      VALUES('load'||n,inst,inst,t,st-1,'seq'||n,due-interval '16 minutes','sent',due-interval '16 minutes'); END IF;
  END LOOP;
  -- Same 55s execution budget, 25s send reserve, and 6/9s provider duration as the existing v2 load test.
  FOR m IN 0..p_minutes+359 LOOP
    FOR i IN 1..p_instances LOOP
      inst:=('00000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid;
      cursor_at:=base+make_interval(mins=>m);
      LOOP
        EXIT WHEN cursor_at>=base+make_interval(mins=>m)+interval '30 seconds';
        UPDATE test_clock SET at=cursor_at;
        SELECT * INTO j FROM live_followup_claim_one(inst);
        IF j.id IS NULL THEN
          SELECT next_send_at INTO next_at FROM live_followup_instances WHERE whatsapp_number_id=inst;
          IF next_at>cursor_at THEN cursor_at:=next_at+interval '250 milliseconds'; CONTINUE; END IF;
          EXIT;
        END IF;
        cursor_at:=cursor_at+make_interval(secs=>CASE WHEN i=1 THEN 6 ELSE 9 END);
        -- Conservative completion deadline: a D send that would complete after 15min is skipped.
        IF j.type='D' AND cursor_at>j.scheduled_at+interval '15 minutes' THEN
          UPDATE live_followup_jobs SET status='skipped',reason='late_step' WHERE id=j.id;
        ELSE UPDATE live_followup_jobs SET status='sent',sent_at=cursor_at WHERE id=j.id; END IF;
      END LOOP;
    END LOOP;
  END LOOP;
  INSERT INTO load_results SELECT p_scenario,p_instances,
    count(*) FILTER(WHERE type='D' AND step=0 AND customer_key LIKE 'load%' AND claimed_at IS NOT NULL OR type='D' AND step=0 AND status<>'sent' AND customer_key LIKE 'load%'),
    count(*) FILTER(WHERE type='D' AND step=0 AND status='sent' AND claimed_at IS NOT NULL),
    round(max(extract(epoch FROM sent_at-scheduled_at)/60) FILTER(WHERE type='D' AND step=0 AND claimed_at IS NOT NULL),2),
    count(*) FILTER(WHERE type='A' AND status='sent' AND claimed_at IS NOT NULL),count(*) FILTER(WHERE type='B' AND status='sent' AND claimed_at IS NOT NULL),count(*) FILTER(WHERE type='C' AND status='sent' AND claimed_at IS NOT NULL),count(*) FILTER(WHERE type='E' AND status='sent' AND claimed_at IS NOT NULL),
    count(*) FILTER(WHERE type='D' AND step=1 AND status='sent' AND claimed_at IS NOT NULL),count(*) FILTER(WHERE type='D' AND step=2 AND status='sent' AND claimed_at IS NOT NULL),
    count(*) FILTER(WHERE type='D' AND step=1 AND reason='sem_folga_no_pico'),count(*) FILTER(WHERE type='D' AND step=2 AND reason='sem_folga_no_pico'),
    count(*) FILTER(WHERE type='D' AND step=0 AND reason='late_step'),count(*) FILTER(WHERE status='pending'),
    (SELECT coalesce(max(c),0) FROM (SELECT count(*) c FROM live_followup_jobs x JOIN live_followup_jobs y ON x.whatsapp_number_id=y.whatsapp_number_id AND y.claimed_at>x.claimed_at-interval '1 hour' AND y.claimed_at<=x.claimed_at WHERE x.claimed_at IS NOT NULL GROUP BY x.id) caps),
    count(*) FILTER(WHERE type='A' AND sent_at<base+interval '1 hour'),count(*) FILTER(WHERE type='B' AND sent_at<base+interval '1 hour'),count(*) FILTER(WHERE type='C' AND sent_at<base+interval '1 hour'),count(*) FILTER(WHERE type='D' AND step=0 AND claimed_at IS NOT NULL AND sent_at<base+interval '1 hour')
  FROM live_followup_jobs;
END $$;
SELECT run_load('300 mixed / 1 live',1,75,225);
SELECT run_load('300 mixed / 2 independent lives',2,75,225);
SELECT run_load('only first D / 80 per hour',1,160,0,120);
SELECT run_load('only first D / 80 per hour for 6h',1,480,0,360);
SELECT run_load('only first D / 81 per hour sustained',1,162,0,120);
SELECT run_load('only first D / 100 per hour sustained',1,200,0,120);
TABLE load_results;
SELECT 'LOAD_JSON:'||jsonb_agg(to_jsonb(r))::text FROM load_results r;
DO $$ DECLARE rate integer; BEGIN
  FOR rate IN 65..85 LOOP PERFORM run_load('capacity sweep '||rate||'/h for 6h',1,rate*6,0,360); END LOOP;
END $$;
SELECT 'THRESHOLD_JSON:'||jsonb_build_object('first_failure_per_hour',min(replace(split_part(scenario,' ',3),'/h','')::integer) FILTER(WHERE late_first>0),'last_all_sent_per_hour',max(replace(split_part(scenario,' ',3),'/h','')::integer) FILTER(WHERE late_first=0))::text FROM load_results WHERE scenario LIKE 'capacity sweep%';
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM load_results WHERE pending<>0 OR max_claims_hour>80 OR d_first_max_minutes>15) THEN RAISE EXCEPTION 'queue, validity or hourly cap violated'; END IF;
  IF EXISTS (SELECT 1 FROM load_results WHERE scenario='300 mixed / 2 independent lives' AND d_first_sent<>75) THEN RAISE EXCEPTION 'two independent lives failed first D'; END IF;
  RAISE NOTICE 'PASS real SQL load, number isolation, rolling 80/h';
END $$;
ROLLBACK;