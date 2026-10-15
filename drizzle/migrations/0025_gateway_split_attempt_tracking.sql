ALTER TABLE public.pos_checkout_attempts ADD COLUMN IF NOT EXISTS split_start_gateway text;
ALTER TABLE public.pos_checkout_attempts ADD COLUMN IF NOT EXISTS gateways_tried text[];
COMMENT ON COLUMN public.pos_checkout_attempts.split_start_gateway IS 'Gateway sorteado pela divisao (gateway_split_config) para comecar a cascata; NULL = divisao desligada ou debito.';
COMMENT ON COLUMN public.pos_checkout_attempts.gateways_tried IS 'Gateways efetivamente tentados na cascata, em ordem.';

CREATE OR REPLACE FUNCTION public.gateway_split_stats(p_days int DEFAULT 30)
RETURNS TABLE(
  gateway text,
  attempts bigint,
  approved bigint,
  approval_rate numeric,
  approved_amount numeric,
  plano_b_approved bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    a.gateway,
    count(*) AS attempts,
    count(*) FILTER (WHERE a.status = 'success') AS approved,
    round(100.0 * count(*) FILTER (WHERE a.status = 'success') / nullif(count(*), 0), 1) AS approval_rate,
    coalesce(sum(a.amount) FILTER (WHERE a.status = 'success'), 0) AS approved_amount,
    count(*) FILTER (WHERE a.status = 'success' AND a.split_start_gateway IS NOT NULL AND a.gateway <> a.split_start_gateway) AS plano_b_approved
  FROM public.pos_checkout_attempts a
  WHERE a.created_at >= now() - make_interval(days => greatest(p_days, 1))
    AND a.gateway IS NOT NULL
  GROUP BY a.gateway
  ORDER BY approved_amount DESC;
$$;

GRANT EXECUTE ON FUNCTION public.gateway_split_stats(int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.gateway_split_stats(int) TO service_role;