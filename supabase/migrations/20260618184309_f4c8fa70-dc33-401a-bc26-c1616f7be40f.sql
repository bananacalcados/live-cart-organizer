ALTER TABLE public.customers_unified
  ADD COLUMN IF NOT EXISTS opt_out_mass_dispatch boolean NOT NULL DEFAULT false;

CREATE OR REPLACE VIEW public.crm_customers_v
WITH (security_invoker = true)
AS
SELECT
  cu.id,
  cu.customer_code AS zoppy_id,
  NULLIF(split_part(COALESCE(cu.name,''), ' ', 1), '') AS first_name,
  NULLIF(btrim(substring(COALESCE(cu.name,'') FROM position(' ' IN COALESCE(cu.name,'')) + 1)), '') AS last_name,
  cu.name,
  cu.phone_e164 AS phone,
  cu.phone_e164,
  cu.phone_suffix8,
  cu.email,
  cu.cpf,
  cu.city,
  cu.state,
  COALESCE(cu.region_type, 'Online') AS region_type,
  cu.ddd,
  cu.rfm_r AS rfm_recency_score,
  cu.rfm_f AS rfm_frequency_score,
  cu.rfm_m AS rfm_monetary_score,
  cu.rfm_total AS rfm_total_score,
  cu.rfm_segment,
  cu.total_orders,
  cu.total_spent,
  cu.avg_ticket,
  cu.last_purchase_at,
  cu.first_purchase_at,
  cu.tags,
  cu.opt_out_mass_dispatch,
  cu.is_archived,
  cu.created_at,
  cu.updated_at
FROM public.customers_unified cu
WHERE cu.is_archived = false;

GRANT SELECT ON public.crm_customers_v TO authenticated;
GRANT SELECT ON public.crm_customers_v TO service_role;