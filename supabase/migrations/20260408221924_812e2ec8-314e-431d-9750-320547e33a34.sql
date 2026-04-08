
-- 1. Add opt_out column
ALTER TABLE public.zoppy_customers 
ADD COLUMN IF NOT EXISTS opt_out_mass_dispatch boolean NOT NULL DEFAULT false;

-- 2. Helper function: extract DDD + last 8 digits from any BR phone
CREATE OR REPLACE FUNCTION public.extract_phone_ddd_suffix(raw_phone text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $$
DECLARE
  digits text;
  ddd text;
  suffix text;
BEGIN
  digits := regexp_replace(COALESCE(raw_phone, ''), '[^0-9]', '', 'g');
  IF length(digits) < 10 THEN RETURN NULL; END IF;

  -- Remove country code 55 if present (12+ digits starting with 55)
  IF length(digits) >= 12 AND left(digits, 2) = '55' THEN
    digits := substring(digits from 3);
  END IF;

  -- Now we have 10 or 11 digits: DDD(2) + local(8 or 9)
  ddd := left(digits, 2);
  suffix := right(digits, 8);

  RETURN ddd || suffix;
END;
$$;

-- 3. One-time dedup function
CREATE OR REPLACE FUNCTION public.merge_duplicate_zoppy_customers()
RETURNS TABLE(duplicates_found bigint, records_deleted bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_duplicates bigint := 0;
  v_deleted bigint := 0;
  rec RECORD;
BEGIN
  FOR rec IN
    WITH keyed AS (
      SELECT id, phone, first_name, last_name, total_orders, total_spent,
             last_purchase_at, first_purchase_at, created_at,
             extract_phone_ddd_suffix(phone) as phone_key
      FROM zoppy_customers
      WHERE phone IS NOT NULL
    ),
    dups AS (
      SELECT phone_key, count(*) as cnt
      FROM keyed
      WHERE phone_key IS NOT NULL
      GROUP BY phone_key
      HAVING count(*) > 1
    )
    SELECT d.phone_key, d.cnt
    FROM dups d
  LOOP
    v_duplicates := v_duplicates + rec.cnt - 1;

    -- Keep the record with most recent activity; merge totals
    WITH ranked AS (
      SELECT id, total_orders, total_spent, first_purchase_at,
             ROW_NUMBER() OVER (
               ORDER BY COALESCE(last_purchase_at, '1900-01-01'::timestamptz) DESC,
                        COALESCE(total_spent, 0) DESC,
                        created_at DESC
             ) as rn
      FROM zoppy_customers
      WHERE extract_phone_ddd_suffix(phone) = rec.phone_key
        AND phone IS NOT NULL
    ),
    totals AS (
      SELECT 
        SUM(COALESCE(total_orders, 0)) as sum_orders,
        SUM(COALESCE(total_spent, 0)) as sum_spent,
        MIN(first_purchase_at) as min_first_purchase
      FROM ranked
      WHERE rn > 1
    )
    UPDATE zoppy_customers 
    SET total_orders = COALESCE(zoppy_customers.total_orders, 0) + COALESCE(t.sum_orders, 0),
        total_spent = COALESCE(zoppy_customers.total_spent, 0) + COALESCE(t.sum_spent, 0),
        first_purchase_at = LEAST(zoppy_customers.first_purchase_at, t.min_first_purchase)
    FROM ranked r, totals t
    WHERE zoppy_customers.id = r.id AND r.rn = 1;

    -- Delete duplicates (non-primary)
    WITH ranked AS (
      SELECT id,
             ROW_NUMBER() OVER (
               ORDER BY COALESCE(last_purchase_at, '1900-01-01'::timestamptz) DESC,
                        COALESCE(total_spent, 0) DESC,
                        created_at DESC
             ) as rn
      FROM zoppy_customers
      WHERE extract_phone_ddd_suffix(phone) = rec.phone_key
        AND phone IS NOT NULL
    )
    DELETE FROM zoppy_customers
    WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

    v_deleted := v_deleted + rec.cnt - 1;
  END LOOP;

  RETURN QUERY SELECT v_duplicates, v_deleted;
END;
$$;
