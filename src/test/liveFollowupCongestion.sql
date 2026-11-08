-- Read-only simulation: 100 overdue jobs, 80 available slots; no queue writes or provider calls.
WITH fixture AS (
 SELECT n,
 CASE WHEN n<=20 THEN 'E' WHEN n<=40 THEN CASE WHEN n%2=0 THEN 'F' ELSE 'D' END
 WHEN n<=60 THEN CASE WHEN n%2=0 THEN 'F' ELSE 'D' END
 WHEN n<=80 THEN CASE WHEN n%2=0 THEN 'F' ELSE 'D' END
 ELSE (ARRAY['A','B','C','F'])[1+n%4] END AS type,
 CASE WHEN n<=20 THEN 0 WHEN n<=40 THEN CASE WHEN n%2=0 THEN 3 ELSE 2 END
 WHEN n<=60 THEN CASE WHEN n%2=0 THEN 2 ELSE 1 END
 WHEN n<=80 THEN CASE WHEN n%2=0 THEN 1 ELSE 0 END ELSE 0 END AS step,
 timestamptz '2026-11-08 18:20:00+00'-make_interval(secs=>101-n) AS scheduled_at
 FROM generate_series(1,100) n
), ranked AS (
 SELECT *,public.live_followup_priority(type,step) priority
 FROM fixture
), admitted AS (
 SELECT * FROM ranked ORDER BY priority,scheduled_at,n LIMIT 80
)
SELECT
 (SELECT array_agg(n ORDER BY priority,scheduled_at,n) FROM admitted)=
 (SELECT array_agg(n ORDER BY bucket,n) FROM (
 SELECT n,CASE WHEN n>80 THEN 0 WHEN n>60 THEN 1 WHEN n>40 THEN 2 ELSE 3 END bucket
 FROM generate_series(21,100) n) expected) AS exact_order_and_oldest_first,
 (SELECT count(*) FROM admitted)=80 AS hourly_80_limit,
 NOT EXISTS(SELECT 1 FROM admitted WHERE type='E') AS crossell_last,
 (SELECT array_agg(DISTINCT type ORDER BY type) FROM admitted WHERE priority=0)=ARRAY['A','B','C','F'] AS all_link_types_first,
 0 AS provider_calls;