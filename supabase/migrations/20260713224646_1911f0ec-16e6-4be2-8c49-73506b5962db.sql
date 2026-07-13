-- 1) Trigger: incluir vendas ONLINE além das físicas
CREATE OR REPLACE FUNCTION public.trg_pos_sale_completed_automation()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
DECLARE
  v_url text := 'https://tqxhcyuxgqbzqwoidpie.supabase.co/functions/v1/automation-trigger-pos-sale';
  v_anon text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRxeGhjeXV4Z3FienF3b2lkcGllIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA1MTM2OTYsImV4cCI6MjA4NjA4OTY5Nn0.TaAi_9LF5UKbfFCc2lMI7rX5s_AOkiSNcZSAvhXgbXk';
BEGIN
  IF NEW.status = 'completed'
     AND COALESCE(NEW.sale_type,'physical') IN ('physical','online')
     AND (TG_OP = 'INSERT' OR COALESCE(OLD.status,'') <> 'completed') THEN
    PERFORM net.http_post(
      url := v_url,
      headers := jsonb_build_object('Content-Type','application/json','apikey',v_anon,'Authorization','Bearer '||v_anon),
      body := jsonb_build_object('sale_id', NEW.id)
    );
  END IF;
  RETURN NEW;
END;
$function$;

-- 2) RPC: estatísticas agregadas de acionamentos por automação (sem limite de 1000 linhas)
CREATE OR REPLACE FUNCTION public.get_automation_exec_stats()
  RETURNS TABLE(flow_id uuid, total bigint, success bigint, failed bigint, last_at timestamptz)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
  SELECT
    e.flow_id,
    count(*)::bigint AS total,
    count(*) FILTER (WHERE e.status IN ('success','sent','delivered','read'))::bigint AS success,
    count(*) FILTER (WHERE e.status IN ('error','failed'))::bigint AS failed,
    max(e.executed_at) AS last_at
  FROM public.automation_executions e
  GROUP BY e.flow_id;
$function$;

GRANT EXECUTE ON FUNCTION public.get_automation_exec_stats() TO authenticated;

-- 3) RPC: cashback disponível por lista de telefones (match por sufixo de 8 dígitos)
CREATE OR REPLACE FUNCTION public.lookup_cashback_by_phones(p_phones text[])
  RETURNS TABLE(
    phone text,
    total_available numeric,
    cashback_count bigint,
    coupon_code text,
    cashback_amount numeric,
    min_purchase numeric,
    generated_at timestamptz,
    expires_at timestamptz
  )
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
  WITH inputs AS (
    SELECT DISTINCT
      p AS phone,
      right(regexp_replace(p, '\D', '', 'g'), 8) AS suffix8
    FROM unnest(p_phones) AS p
    WHERE length(right(regexp_replace(p, '\D', '', 'g'), 8)) = 8
  ),
  active AS (
    SELECT
      c.coupon_code,
      c.cashback_amount,
      c.min_purchase,
      c.created_at,
      c.expires_at,
      right(regexp_replace(c.customer_phone, '\D', '', 'g'), 8) AS suffix8
    FROM public.internal_cashback c
    WHERE c.is_used = false
      AND c.expires_at > now()
  ),
  matched AS (
    SELECT
      i.phone,
      a.coupon_code,
      a.cashback_amount,
      a.min_purchase,
      a.created_at,
      a.expires_at,
      row_number() OVER (PARTITION BY i.phone ORDER BY a.created_at DESC) AS rn,
      sum(a.cashback_amount) OVER (PARTITION BY i.phone) AS total_available,
      count(*) OVER (PARTITION BY i.phone) AS cashback_count
    FROM inputs i
    JOIN active a ON a.suffix8 = i.suffix8
  )
  SELECT
    phone,
    total_available,
    cashback_count,
    coupon_code,
    cashback_amount,
    min_purchase,
    created_at AS generated_at,
    expires_at
  FROM matched
  WHERE rn = 1;
$function$;

GRANT EXECUTE ON FUNCTION public.lookup_cashback_by_phones(text[]) TO authenticated;