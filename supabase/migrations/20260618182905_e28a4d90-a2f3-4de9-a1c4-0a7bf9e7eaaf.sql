CREATE OR REPLACE FUNCTION public.merge_unified_zoppy_duplicates()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_run uuid := gen_random_uuid();
  v_merged int := 0;
  v_changed int;
BEGIN
  CREATE TEMP TABLE _edges ON COMMIT DROP AS
  SELECT cu.id AS cu_id, replace(o,'zoppy:','') AS zid
  FROM public.customers_unified cu
  CROSS JOIN LATERAL jsonb_array_elements_text(
     CASE WHEN jsonb_typeof(cu.source_origins)='array' THEN cu.source_origins ELSE '[]'::jsonb END) o
  WHERE o LIKE 'zoppy:%' AND cu.merged_into_id IS NULL;
  CREATE INDEX ON _edges(cu_id);
  CREATE INDEX ON _edges(zid);

  CREATE TEMP TABLE _lbl ON COMMIT DROP AS
  SELECT DISTINCT cu_id, cu_id::text AS lbl FROM _edges;
  CREATE INDEX ON _lbl(cu_id);

  LOOP
    WITH zid_min AS (
      SELECT e.zid, min(l.lbl) AS m
      FROM _edges e JOIN _lbl l ON l.cu_id = e.cu_id
      GROUP BY e.zid
    ),
    cu_min AS (
      SELECT e.cu_id, min(zm.m) AS m
      FROM _edges e JOIN zid_min zm ON zm.zid = e.zid
      GROUP BY e.cu_id
    )
    UPDATE _lbl l SET lbl = cm.m
    FROM cu_min cm
    WHERE cm.cu_id = l.cu_id AND l.lbl <> cm.m;
    GET DIAGNOSTICS v_changed = ROW_COUNT;
    EXIT WHEN v_changed = 0;
  END LOOP;

  CREATE TEMP TABLE _comp ON COMMIT DROP AS
  SELECT lbl FROM _lbl GROUP BY lbl HAVING count(*) > 1;

  CREATE TEMP TABLE _surv ON COMMIT DROP AS
  SELECT DISTINCT ON (l.lbl) l.lbl, l.cu_id AS survivor
  FROM _lbl l
  JOIN _comp c ON c.lbl = l.lbl
  JOIN public.customers_unified cu ON cu.id = l.cu_id
  ORDER BY l.lbl,
    (coalesce(cu.phone_e164,'')<>'') DESC,
    (coalesce(cu.cpf,'')<>'') DESC,
    cu.legacy_orders DESC NULLS LAST,
    cu.created_at ASC;

  CREATE TEMP TABLE _map ON COMMIT DROP AS
  SELECT l.cu_id AS loser, s.survivor
  FROM _lbl l JOIN _surv s ON s.lbl = l.lbl
  WHERE l.cu_id <> s.survivor;
  CREATE INDEX ON _map(loser);
  CREATE INDEX ON _map(survivor);

  WITH agg AS (
    SELECT s.survivor,
      max(cu.legacy_orders) AS lo,
      max(cu.legacy_spent) AS ls,
      min(cu.legacy_first_purchase_at) AS lf,
      max(cu.legacy_last_purchase_at) AS ll
    FROM _lbl l JOIN _surv s ON s.lbl = l.lbl
    JOIN public.customers_unified cu ON cu.id = l.cu_id
    GROUP BY s.survivor
  )
  UPDATE public.customers_unified cu SET
    legacy_orders = agg.lo,
    legacy_spent = agg.ls,
    legacy_first_purchase_at = agg.lf,
    legacy_last_purchase_at = agg.ll
  FROM agg WHERE cu.id = agg.survivor;

  WITH best AS (
    SELECT DISTINCT ON (m.survivor) m.survivor, cu.phone_e164, cu.ddd, cu.email, cu.name
    FROM _map m JOIN public.customers_unified cu ON cu.id = m.loser
    ORDER BY m.survivor,
      (coalesce(cu.phone_e164,'')<>'') DESC,
      (coalesce(cu.email,'')<>'') DESC
  )
  UPDATE public.customers_unified s SET
    phone_e164 = COALESCE(NULLIF(s.phone_e164,''), b.phone_e164),
    ddd = COALESCE(NULLIF(s.ddd,''), b.ddd),
    email = COALESCE(NULLIF(s.email,''), b.email),
    name = COALESCE(NULLIF(s.name,''), b.name)
  FROM best b WHERE s.id = b.survivor;

  WITH comp_origins AS (
    SELECT s.survivor AS sid, ax AS val
    FROM _surv s
    JOIN _lbl l ON l.lbl = s.lbl
    JOIN public.customers_unified cu ON cu.id = l.cu_id
    CROSS JOIN LATERAL jsonb_array_elements_text(
       CASE WHEN jsonb_typeof(cu.source_origins)='array' THEN cu.source_origins ELSE '[]'::jsonb END) ax
  ),
  agg2 AS (SELECT sid, jsonb_agg(DISTINCT val) AS origs FROM comp_origins GROUP BY sid)
  UPDATE public.customers_unified s SET source_origins = agg2.origs
  FROM agg2 WHERE s.id = agg2.sid;

  -- list memberships: drop any loser membership that would collide (with survivor OR another member) in the same list
  DELETE FROM public.customer_list_memberships cm
  USING _map m
  WHERE cm.customer_id = m.loser
    AND EXISTS (
      SELECT 1 FROM public.customer_list_memberships c2
      LEFT JOIN _map m2 ON m2.loser = c2.customer_id
      WHERE c2.list_id = cm.list_id
        AND COALESCE(m2.survivor, c2.customer_id) = m.survivor
        AND c2.id < cm.id
    );
  UPDATE public.customer_list_memberships cm SET customer_id = m.survivor
  FROM _map m WHERE cm.customer_id = m.loser;

  UPDATE public.pos_sales ps SET customer_unified_id = m.survivor
  FROM _map m WHERE ps.customer_unified_id = m.loser;
  UPDATE public.orders o SET customer_unified_id = m.survivor
  FROM _map m WHERE o.customer_unified_id = m.loser;

  UPDATE public.customers_unified cu
  SET merged_into_id = m.survivor, is_archived = true, updated_at = now()
  FROM _map m WHERE cu.id = m.loser;
  GET DIAGNOSTICS v_merged = ROW_COUNT;

  INSERT INTO public.master_merge_log(run_id, base_name, canonical_master_id, loser_master_id, action, details)
  SELECT v_run, 'customers_unified', m.survivor, m.loser, 'merge_zoppy_duplicate',
         jsonb_build_object('reason','zoppy_origin_connected_component')
  FROM _map m;

  RETURN jsonb_build_object('run_id', v_run, 'losers_merged', v_merged);
END;
$function$;