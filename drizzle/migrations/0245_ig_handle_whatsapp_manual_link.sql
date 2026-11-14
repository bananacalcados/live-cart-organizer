CREATE OR REPLACE FUNCTION public.ig_link_norm_phone(_p text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  WITH d AS (SELECT regexp_replace(coalesce(_p,''), '\D', '', 'g') AS v),
  c AS (SELECT CASE WHEN length(v) IN (10,11) THEN '55'||v ELSE v END AS v FROM d)
  SELECT CASE
    WHEN length(v) = 12 AND v LIKE '55%' THEN substr(v,1,4)||'9'||substr(v,5)
    WHEN length(v) = 13 AND v LIKE '55%' THEN v
    ELSE NULL END FROM c
$$;

CREATE OR REPLACE FUNCTION public.ig_handle_link_lookup(_handle text, _phone text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE h text := public.ig_handle_norm(_handle); p text := public.ig_link_norm_phone(_phone);
  cur record; uname text; others jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_module_access(auth.uid(), 'events') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  IF h IS NULL THEN RAISE EXCEPTION 'invalid_handle' USING ERRCODE='22023'; END IF;
  SELECT id, full_name, whatsapp INTO cur FROM public.customers WHERE public.ig_handle_norm(instagram_handle) = h LIMIT 1;
  IF p IS NOT NULL THEN
    SELECT name INTO uname FROM public.customers_unified WHERE phone_suffix8 = right(p,8) AND name IS NOT NULL ORDER BY updated_at DESC NULLS LAST LIMIT 1;
    SELECT coalesce(jsonb_agg(DISTINCT public.ig_handle_norm(instagram_handle)), '[]'::jsonb) INTO others
      FROM (SELECT instagram_handle FROM public.customers
            WHERE right(regexp_replace(coalesce(whatsapp,''),'\D','','g'),8) = right(p,8)
              AND public.ig_handle_norm(instagram_handle) IS DISTINCT FROM h LIMIT 10) x;
  END IF;
  RETURN jsonb_build_object('handle', h, 'phone', p, 'current_name', cur.full_name, 'current_whatsapp', cur.whatsapp,
    'suggested_name', uname, 'other_handles', coalesce(others,'[]'::jsonb));
END $$;

CREATE OR REPLACE FUNCTION public.link_ig_handle_whatsapp(_handle text, _phone text, _name text DEFAULT NULL, _force boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE h text := public.ig_handle_norm(_handle); p text := public.ig_link_norm_phone(_phone);
  nm text := nullif(left(btrim(coalesce(_name,'')),160),''); cur record; others text[]; cid uuid; hist text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_module_access(auth.uid(), 'events') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  IF h IS NULL THEN RAISE EXCEPTION 'invalid_handle' USING ERRCODE='22023'; END IF;
  IF p IS NULL THEN RAISE EXCEPTION 'invalid_phone' USING ERRCODE='22023'; END IF;
  SELECT array_agg(DISTINCT public.ig_handle_norm(instagram_handle)) INTO others FROM public.customers
    WHERE right(regexp_replace(coalesce(whatsapp,''),'\D','','g'),8) = right(p,8)
      AND public.ig_handle_norm(instagram_handle) IS DISTINCT FROM h;
  IF others IS NOT NULL AND NOT _force THEN
    RETURN jsonb_build_object('ok', false, 'conflict', true, 'other_handles', to_jsonb(others)); END IF;
  hist := 'manual:@' || h;
  SELECT id, full_name, whatsapp INTO cur FROM public.customers WHERE public.ig_handle_norm(instagram_handle) = h FOR UPDATE LIMIT 1;
  IF cur.id IS NULL THEN
    INSERT INTO public.customers (instagram_handle, whatsapp, full_name) VALUES (h, p, nm) RETURNING id INTO cid;
  ELSE
    cid := cur.id;
    IF nullif(btrim(coalesce(cur.whatsapp,'')),'') IS NOT NULL AND right(regexp_replace(cur.whatsapp,'\D','','g'),8) <> right(p,8) THEN
      INSERT INTO public.instagram_customer_links (ig_user_id, username_norm, phone, customer_id, status, created_by)
      VALUES (hist, h, cur.whatsapp, cid, 'rejected', auth.uid())
      ON CONFLICT (ig_user_id, phone) DO UPDATE SET status='rejected', updated_at=now();
    END IF;
    UPDATE public.customers SET whatsapp = p,
      full_name = CASE WHEN nullif(btrim(coalesce(full_name,'')),'') IS NULL THEN nm ELSE full_name END,
      updated_at = now()
    WHERE id = cid AND (whatsapp IS DISTINCT FROM p OR (nullif(btrim(coalesce(full_name,'')),'') IS NULL AND nm IS NOT NULL));
  END IF;
  INSERT INTO public.instagram_customer_links (ig_user_id, username_norm, phone, customer_id, status, created_by)
  VALUES (hist, h, p, cid, 'confirmed', auth.uid())
  ON CONFLICT (ig_user_id, phone) DO UPDATE SET status='confirmed', customer_id=EXCLUDED.customer_id, created_by=EXCLUDED.created_by, updated_at=now();
  RETURN jsonb_build_object('ok', true, 'customer_id', cid, 'handle', h, 'whatsapp', p);
END $$;

REVOKE ALL ON FUNCTION public.ig_link_norm_phone(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ig_handle_link_lookup(text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.link_ig_handle_whatsapp(text, text, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ig_link_norm_phone(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ig_handle_link_lookup(text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.link_ig_handle_whatsapp(text, text, text, boolean) TO authenticated, service_role;