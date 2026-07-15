
-- ============================================================================
-- FASE 1 — Preparação da consolidação de identidades em customers_unified
-- ============================================================================
-- Cria estrutura + funções (todas em dry-run por padrão). Nenhuma linha de
-- customers_unified é modificada por esta migration.
-- Cutoff PDV: 2026-02-11 (primeira pos_sale). Compras posteriores são
-- exclusivamente transacionais; legacy = Zoppy real anterior a essa data.
-- ============================================================================

-- 1. identity_blacklist -------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.identity_blacklist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('email','phone_suffix8','cpf')),
  value text NOT NULL,
  reason text NOT NULL,
  distinct_cpfs int,
  distinct_phones int,
  distinct_names int,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kind, value)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.identity_blacklist TO authenticated;
GRANT ALL ON public.identity_blacklist TO service_role;
ALTER TABLE public.identity_blacklist ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_manage_identity_blacklist" ON public.identity_blacklist
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

INSERT INTO public.identity_blacklist(kind, value, reason, distinct_cpfs, distinct_phones)
SELECT 'email', lower(trim(email)), 'shared_by_multiple_identities',
       COUNT(DISTINCT cpf) FILTER (WHERE cpf IS NOT NULL),
       COUNT(DISTINCT phone_suffix8) FILTER (WHERE phone_suffix8 IS NOT NULL)
FROM public.customers_unified
WHERE email IS NOT NULL AND length(trim(email)) > 3
GROUP BY 1, 2
HAVING COUNT(DISTINCT cpf) FILTER (WHERE cpf IS NOT NULL) >= 3
    OR COUNT(DISTINCT phone_suffix8) FILTER (WHERE phone_suffix8 IS NOT NULL) >= 5
ON CONFLICT (kind, value) DO NOTHING;

INSERT INTO public.identity_blacklist(kind, value, reason, distinct_cpfs, distinct_names)
SELECT 'phone_suffix8', phone_suffix8, 'shared_by_multiple_identities',
       COUNT(DISTINCT cpf) FILTER (WHERE cpf IS NOT NULL),
       COUNT(DISTINCT lower(trim(name))) FILTER (WHERE name IS NOT NULL)
FROM public.customers_unified
WHERE phone_suffix8 IS NOT NULL
GROUP BY 1, 2
HAVING COUNT(DISTINCT cpf) FILTER (WHERE cpf IS NOT NULL) >= 5
    OR COUNT(DISTINCT lower(trim(name))) FILTER (WHERE name IS NOT NULL) >= 8
ON CONFLICT (kind, value) DO NOTHING;

INSERT INTO public.identity_blacklist(kind, value, reason)
VALUES
  ('cpf','00000000000','fake_cpf'),('cpf','11111111111','fake_cpf'),
  ('cpf','22222222222','fake_cpf'),('cpf','33333333333','fake_cpf'),
  ('cpf','44444444444','fake_cpf'),('cpf','55555555555','fake_cpf'),
  ('cpf','66666666666','fake_cpf'),('cpf','77777777777','fake_cpf'),
  ('cpf','88888888888','fake_cpf'),('cpf','99999999999','fake_cpf'),
  ('cpf','12345678909','fake_cpf'),
  ('phone_suffix8','00000000','all_zeros'),
  ('phone_suffix8','11111111','all_same'),
  ('phone_suffix8','99999999','all_same'),
  ('phone_suffix8','12345678','sequence')
ON CONFLICT DO NOTHING;

-- 2. unified_merge_log + snapshot metadata -----------------------------------
CREATE TABLE IF NOT EXISTS public.unified_merge_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merge_batch_id uuid NOT NULL,
  rule text NOT NULL CHECK (rule IN ('cpf','phone_suffix8','email')),
  survivor_id uuid NOT NULL,
  absorbed_id uuid NOT NULL,
  absorbed_row jsonb NOT NULL,
  fks_repointed jsonb NOT NULL DEFAULT '{}'::jsonb,
  mirror_sales_detected int NOT NULL DEFAULT 0,
  merged_at timestamptz NOT NULL DEFAULT now(),
  reverted_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_uml_batch ON public.unified_merge_log(merge_batch_id);
CREATE INDEX IF NOT EXISTS idx_uml_survivor ON public.unified_merge_log(survivor_id);
CREATE INDEX IF NOT EXISTS idx_uml_absorbed ON public.unified_merge_log(absorbed_id);
GRANT SELECT ON public.unified_merge_log TO authenticated;
GRANT ALL ON public.unified_merge_log TO service_role;
ALTER TABLE public.unified_merge_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_read_unified_merge_log" ON public.unified_merge_log
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE TABLE IF NOT EXISTS public.unified_dedup_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_table text NOT NULL,
  rows_count bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  note text
);
GRANT SELECT ON public.unified_dedup_snapshots TO authenticated;
GRANT ALL ON public.unified_dedup_snapshots TO service_role;
ALTER TABLE public.unified_dedup_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_read_dedup_snapshots" ON public.unified_dedup_snapshots
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- 3. Helpers de identidade ---------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_email_placeholder(p_email text)
RETURNS boolean LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT p_email IS NULL
      OR length(trim(p_email)) < 5
      OR EXISTS (SELECT 1 FROM public.identity_blacklist
                 WHERE kind='email' AND value = lower(trim(p_email)));
$$;

CREATE OR REPLACE FUNCTION public.is_phone_generic(p_suffix8 text)
RETURNS boolean LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT p_suffix8 IS NULL
      OR length(p_suffix8) <> 8
      OR EXISTS (SELECT 1 FROM public.identity_blacklist
                 WHERE kind='phone_suffix8' AND value = p_suffix8);
$$;

CREATE OR REPLACE FUNCTION public.is_cpf_mergeable(p_cpf text)
RETURNS boolean LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT p_cpf IS NOT NULL
     AND length(p_cpf) = 11
     AND NOT EXISTS (SELECT 1 FROM public.identity_blacklist
                     WHERE kind='cpf' AND value = p_cpf);
$$;

CREATE OR REPLACE FUNCTION public.zoppy_origin_class(p_zoppy_id text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_zoppy_id LIKE 'pos-%' THEN 'buffer_pos'
    WHEN p_zoppy_id LIKE 'tiny-%' THEN 'buffer_tiny'
    WHEN p_zoppy_id ~ '^[a-f0-9-]{36}$' THEN 'buffer_uuid'
    WHEN p_zoppy_id LIKE 'chat-%' THEN 'buffer_chat'
    ELSE 'zoppy_real'
  END;
$$;

-- normalize_phone_br idempotente ---------------------------------------------
DO $do$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE p.proname='normalize_phone_br' AND n.nspname='public'
  ) THEN
    EXECUTE $sql$
    CREATE FUNCTION public.normalize_phone_br(p_raw text)
    RETURNS text LANGUAGE plpgsql IMMUTABLE AS $inner$
    DECLARE d text;
    BEGIN
      IF p_raw IS NULL THEN RETURN NULL; END IF;
      d := regexp_replace(p_raw, '\D', '', 'g');
      IF d IS NULL OR length(d) < 10 THEN RETURN NULL; END IF;
      IF length(d) >= 12 AND left(d,2) = '55' THEN d := substr(d,3); END IF;
      IF length(d) = 10 THEN d := substr(d,1,2) || '9' || substr(d,3); END IF;
      IF length(d) <> 11 THEN RETURN NULL; END IF;
      RETURN '55' || d;
    END;
    $inner$;
    $sql$;
  END IF;
END $do$;

-- 4. simulate_merge_unified_duplicates ---------------------------------------
CREATE OR REPLACE FUNCTION public.simulate_merge_unified_duplicates()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  WITH
  cpf_groups AS (
    SELECT cpf,
           array_agg(id ORDER BY
             COALESCE(last_purchase_at,'1900-01-01'::timestamptz) DESC,
             total_orders DESC NULLS LAST,
             (cpf IS NULL), (phone_e164 IS NULL),
             created_at ASC, id ASC
           ) AS ids,
           count(*) AS n
    FROM public.customers_unified
    WHERE public.is_cpf_mergeable(cpf) AND merged_into_id IS NULL
    GROUP BY cpf
    HAVING count(*) >= 2
  ),
  cpf_summary AS (
    SELECT count(*)::int AS groups, coalesce(sum(n-1),0)::int AS rows_to_absorb
    FROM cpf_groups
  ),
  cpf_sample AS (
    SELECT jsonb_agg(
      jsonb_build_object(
        'rule','cpf',
        'cpf', g.cpf,
        'group_size', g.n,
        'survivor_id', g.ids[1],
        'absorbed_ids', g.ids[2:],
        'mirror_sales_detected', (
          SELECT COALESCE(count(*) - count(DISTINCT so_val), 0)::int
          FROM public.customers_unified cu2,
               LATERAL jsonb_array_elements_text(
                 CASE WHEN jsonb_typeof(cu2.source_origins)='array'
                      THEN cu2.source_origins ELSE '[]'::jsonb END
               ) so_val
          WHERE cu2.id = ANY(g.ids)
            AND (so_val LIKE 'pos-%' OR so_val LIKE 'tiny-%')
        ),
        'rows', (
          SELECT jsonb_agg(jsonb_build_object(
            'id', cu.id, 'name', cu.name, 'cpf', cu.cpf, 'phone_e164', cu.phone_e164,
            'email', cu.email, 'total_orders', cu.total_orders, 'total_spent', cu.total_spent,
            'last_purchase_at', cu.last_purchase_at,
            'source_origins', cu.source_origins
          ) ORDER BY array_position(g.ids, cu.id))
          FROM public.customers_unified cu WHERE cu.id = ANY(g.ids)
        )
      )
    ) AS sample
    FROM (SELECT * FROM cpf_groups ORDER BY random() LIMIT 20) g
  ),

  phone_groups_all AS (
    SELECT phone_suffix8,
           array_agg(id ORDER BY
             COALESCE(last_purchase_at,'1900-01-01'::timestamptz) DESC,
             total_orders DESC NULLS LAST,
             (cpf IS NULL), (phone_e164 IS NULL),
             created_at ASC, id ASC
           ) AS ids,
           count(*) AS n,
           count(DISTINCT cpf) FILTER (WHERE public.is_cpf_mergeable(cpf))::int AS distinct_cpfs
    FROM public.customers_unified
    WHERE NOT public.is_phone_generic(phone_suffix8)
      AND merged_into_id IS NULL
    GROUP BY phone_suffix8
    HAVING count(*) >= 2
  ),
  phone_ok AS (SELECT * FROM phone_groups_all WHERE distinct_cpfs <= 1),
  phone_conflict AS (SELECT * FROM phone_groups_all WHERE distinct_cpfs >= 2),
  phone_summary AS (
    SELECT (SELECT count(*)::int FROM phone_ok) AS groups,
           (SELECT coalesce(sum(n-1),0)::int FROM phone_ok) AS rows_to_absorb,
           (SELECT count(*)::int FROM phone_conflict) AS identity_conflicts,
           (SELECT coalesce(sum(n),0)::int FROM phone_conflict) AS rows_in_conflict
  ),
  phone_sample AS (
    SELECT jsonb_agg(
      jsonb_build_object(
        'rule','phone_suffix8',
        'phone_suffix8', g.phone_suffix8,
        'group_size', g.n,
        'survivor_id', g.ids[1],
        'absorbed_ids', g.ids[2:],
        'mirror_sales_detected', (
          SELECT COALESCE(count(*) - count(DISTINCT so_val), 0)::int
          FROM public.customers_unified cu2,
               LATERAL jsonb_array_elements_text(
                 CASE WHEN jsonb_typeof(cu2.source_origins)='array'
                      THEN cu2.source_origins ELSE '[]'::jsonb END
               ) so_val
          WHERE cu2.id = ANY(g.ids)
            AND (so_val LIKE 'pos-%' OR so_val LIKE 'tiny-%')
        ),
        'rows', (
          SELECT jsonb_agg(jsonb_build_object(
            'id', cu.id, 'name', cu.name, 'cpf', cu.cpf, 'phone_e164', cu.phone_e164,
            'email', cu.email, 'total_orders', cu.total_orders, 'total_spent', cu.total_spent,
            'last_purchase_at', cu.last_purchase_at,
            'source_origins', cu.source_origins
          ) ORDER BY array_position(g.ids, cu.id))
          FROM public.customers_unified cu WHERE cu.id = ANY(g.ids)
        )
      )
    ) AS sample
    FROM (SELECT * FROM phone_ok ORDER BY random() LIMIT 20) g
  ),
  phone_conflict_sample AS (
    SELECT jsonb_agg(
      jsonb_build_object(
        'phone_suffix8', g.phone_suffix8,
        'group_size', g.n,
        'distinct_cpfs', g.distinct_cpfs,
        'rows', (
          SELECT jsonb_agg(jsonb_build_object(
            'id', cu.id, 'name', cu.name, 'cpf', cu.cpf, 'phone_e164', cu.phone_e164,
            'last_purchase_at', cu.last_purchase_at
          ))
          FROM public.customers_unified cu WHERE cu.id = ANY(g.ids)
        )
      )
    ) AS sample
    FROM (SELECT * FROM phone_conflict ORDER BY random() LIMIT 10) g
  ),

  email_groups_all AS (
    SELECT lower(trim(email)) AS email_norm,
           array_agg(id ORDER BY
             COALESCE(last_purchase_at,'1900-01-01'::timestamptz) DESC,
             total_orders DESC NULLS LAST,
             (cpf IS NULL), (phone_e164 IS NULL),
             created_at ASC, id ASC
           ) AS ids,
           count(*) AS n,
           count(DISTINCT cpf) FILTER (WHERE public.is_cpf_mergeable(cpf))::int AS distinct_cpfs
    FROM public.customers_unified
    WHERE NOT public.is_email_placeholder(email) AND merged_into_id IS NULL
    GROUP BY lower(trim(email))
    HAVING count(*) >= 2
  ),
  email_ok AS (SELECT * FROM email_groups_all WHERE distinct_cpfs <= 1),
  email_conflict AS (SELECT * FROM email_groups_all WHERE distinct_cpfs >= 2),
  email_summary AS (
    SELECT (SELECT count(*)::int FROM email_ok) AS groups,
           (SELECT coalesce(sum(n-1),0)::int FROM email_ok) AS rows_to_absorb,
           (SELECT count(*)::int FROM email_conflict) AS identity_conflicts,
           (SELECT coalesce(sum(n),0)::int FROM email_conflict) AS rows_in_conflict
  ),
  email_sample AS (
    SELECT jsonb_agg(
      jsonb_build_object(
        'rule','email',
        'email', g.email_norm,
        'group_size', g.n,
        'survivor_id', g.ids[1],
        'absorbed_ids', g.ids[2:],
        'mirror_sales_detected', (
          SELECT COALESCE(count(*) - count(DISTINCT so_val), 0)::int
          FROM public.customers_unified cu2,
               LATERAL jsonb_array_elements_text(
                 CASE WHEN jsonb_typeof(cu2.source_origins)='array'
                      THEN cu2.source_origins ELSE '[]'::jsonb END
               ) so_val
          WHERE cu2.id = ANY(g.ids)
            AND (so_val LIKE 'pos-%' OR so_val LIKE 'tiny-%')
        ),
        'rows', (
          SELECT jsonb_agg(jsonb_build_object(
            'id', cu.id, 'name', cu.name, 'cpf', cu.cpf, 'phone_e164', cu.phone_e164,
            'email', cu.email, 'total_orders', cu.total_orders, 'total_spent', cu.total_spent,
            'last_purchase_at', cu.last_purchase_at,
            'source_origins', cu.source_origins
          ) ORDER BY array_position(g.ids, cu.id))
          FROM public.customers_unified cu WHERE cu.id = ANY(g.ids)
        )
      )
    ) AS sample
    FROM (SELECT * FROM email_ok ORDER BY random() LIMIT 20) g
  ),

  kpi AS (
    SELECT count(*)::int AS unified_rows_90d,
           count(DISTINCT COALESCE(cpf, phone_suffix8, lower(email)))::int AS unique_identities_90d
    FROM public.customers_unified
    WHERE last_purchase_at >= now() - interval '90 days' AND merged_into_id IS NULL
  )

  SELECT jsonb_build_object(
    'generated_at', now(),
    'cutoff_pdv', '2026-02-11'::date,
    'cpf_rule', jsonb_build_object(
      'summary', (SELECT to_jsonb(x) FROM cpf_summary x),
      'sample', COALESCE((SELECT sample FROM cpf_sample), '[]'::jsonb)
    ),
    'phone_rule', jsonb_build_object(
      'summary', (SELECT to_jsonb(x) FROM phone_summary x),
      'sample', COALESCE((SELECT sample FROM phone_sample), '[]'::jsonb),
      'conflicts_sample', COALESCE((SELECT sample FROM phone_conflict_sample), '[]'::jsonb)
    ),
    'email_rule', jsonb_build_object(
      'summary', (SELECT to_jsonb(x) FROM email_summary x),
      'sample', COALESCE((SELECT sample FROM email_sample), '[]'::jsonb)
    ),
    'acceptance_kpi_baseline', (SELECT to_jsonb(x) FROM kpi x)
  ) INTO v_result;

  RETURN v_result;
END;
$function$;
REVOKE ALL ON FUNCTION public.simulate_merge_unified_duplicates() FROM public;
GRANT EXECUTE ON FUNCTION public.simulate_merge_unified_duplicates() TO authenticated, service_role;

-- 5. backfill_phones_from_pos_customers --------------------------------------
CREATE OR REPLACE FUNCTION public.backfill_phones_from_pos_customers(p_dry_run boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_result jsonb;
  v_updated int := 0;
BEGIN
  WITH candidates AS (
    SELECT cu.id AS unified_id, cu.cpf, cu.email, cu.last_purchase_at,
           COALESCE(
             (SELECT pc.whatsapp FROM public.pos_customers pc
              WHERE cu.cpf IS NOT NULL AND length(cu.cpf)=11 AND pc.cpf = cu.cpf
                AND pc.whatsapp IS NOT NULL AND length(regexp_replace(pc.whatsapp,'\D','','g')) >= 10
              ORDER BY pc.updated_at DESC LIMIT 1),
             (SELECT pc.whatsapp FROM public.pos_customers pc
              WHERE cu.email IS NOT NULL AND NOT public.is_email_placeholder(cu.email)
                AND lower(pc.email) = lower(cu.email)
                AND pc.whatsapp IS NOT NULL AND length(regexp_replace(pc.whatsapp,'\D','','g')) >= 10
              ORDER BY pc.updated_at DESC LIMIT 1)
           ) AS recovered_phone
    FROM public.customers_unified cu
    WHERE cu.phone_e164 IS NULL AND cu.merged_into_id IS NULL
      AND (cu.cpf IS NOT NULL OR (cu.email IS NOT NULL AND NOT public.is_email_placeholder(cu.email)))
  ),
  cand_with_phone AS (
    SELECT unified_id, cpf, email, last_purchase_at,
           public.normalize_phone_br(recovered_phone) AS phone_e164_new
    FROM candidates WHERE recovered_phone IS NOT NULL
  ),
  buckets AS (
    SELECT
      count(*) FILTER (WHERE phone_e164_new IS NOT NULL)::int AS recoverable_total,
      count(*) FILTER (WHERE phone_e164_new IS NOT NULL AND last_purchase_at >= now()-interval '90 days')::int AS recoverable_90d,
      count(*) FILTER (WHERE phone_e164_new IS NOT NULL AND last_purchase_at >= now()-interval '180 days')::int AS recoverable_180d,
      count(*) FILTER (WHERE phone_e164_new IS NOT NULL AND last_purchase_at >= now()-interval '365 days')::int AS recoverable_365d,
      count(*) FILTER (WHERE phone_e164_new IS NOT NULL AND last_purchase_at IS NULL)::int AS recoverable_no_purchase
    FROM cand_with_phone
  ),
  sample AS (
    SELECT jsonb_agg(jsonb_build_object(
      'unified_id', unified_id, 'cpf', cpf, 'email', email,
      'phone_e164_new', phone_e164_new, 'last_purchase_at', last_purchase_at
    )) AS s
    FROM (SELECT * FROM cand_with_phone WHERE phone_e164_new IS NOT NULL ORDER BY random() LIMIT 20) x
  )
  SELECT jsonb_build_object(
    'dry_run', p_dry_run,
    'generated_at', now(),
    'buckets', (SELECT to_jsonb(b) FROM buckets b),
    'sample', COALESCE((SELECT s FROM sample), '[]'::jsonb)
  ) INTO v_result;

  IF NOT p_dry_run THEN
    WITH cand AS (
      SELECT cu.id AS unified_id,
             COALESCE(
               (SELECT pc.whatsapp FROM public.pos_customers pc
                WHERE cu.cpf IS NOT NULL AND length(cu.cpf)=11 AND pc.cpf = cu.cpf
                  AND pc.whatsapp IS NOT NULL AND length(regexp_replace(pc.whatsapp,'\D','','g')) >= 10
                ORDER BY pc.updated_at DESC LIMIT 1),
               (SELECT pc.whatsapp FROM public.pos_customers pc
                WHERE cu.email IS NOT NULL AND NOT public.is_email_placeholder(cu.email)
                  AND lower(pc.email) = lower(cu.email)
                  AND pc.whatsapp IS NOT NULL AND length(regexp_replace(pc.whatsapp,'\D','','g')) >= 10
                ORDER BY pc.updated_at DESC LIMIT 1)
             ) AS recovered_phone
      FROM public.customers_unified cu
      WHERE cu.phone_e164 IS NULL AND cu.merged_into_id IS NULL
        AND (cu.cpf IS NOT NULL OR (cu.email IS NOT NULL AND NOT public.is_email_placeholder(cu.email)))
    )
    UPDATE public.customers_unified cu
       SET phone_e164 = public.normalize_phone_br(c.recovered_phone),
           phone_suffix8 = right(regexp_replace(public.normalize_phone_br(c.recovered_phone),'\D','','g'), 8),
           updated_at = now()
      FROM cand c
     WHERE cu.id = c.unified_id
       AND c.recovered_phone IS NOT NULL
       AND public.normalize_phone_br(c.recovered_phone) IS NOT NULL;
    GET DIAGNOSTICS v_updated = ROW_COUNT;
    v_result := v_result || jsonb_build_object('rows_updated', v_updated);
  END IF;

  RETURN v_result;
END;
$function$;
REVOKE ALL ON FUNCTION public.backfill_phones_from_pos_customers(boolean) FROM public;
GRANT EXECUTE ON FUNCTION public.backfill_phones_from_pos_customers(boolean) TO authenticated, service_role;

-- 6. Stubs bloqueados até próxima migration ----------------------------------
CREATE OR REPLACE FUNCTION public.execute_merge_unified_duplicates(p_dry_run boolean DEFAULT true, p_rule text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'execute_merge_unified_duplicates ainda não liberado. Rode simulate_merge_unified_duplicates() e valide primeiro.';
END; $$;
REVOKE ALL ON FUNCTION public.execute_merge_unified_duplicates(boolean, text) FROM public;
GRANT EXECUTE ON FUNCTION public.execute_merge_unified_duplicates(boolean, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.revert_merge_batch(p_batch_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'revert_merge_batch será liberado junto com execute_merge_unified_duplicates.';
END; $$;
REVOKE ALL ON FUNCTION public.revert_merge_batch(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.revert_merge_batch(uuid) TO authenticated, service_role;
