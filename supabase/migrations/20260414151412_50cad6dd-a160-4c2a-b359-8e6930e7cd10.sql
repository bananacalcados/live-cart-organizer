-- Fix existing 'unknown' region records: if DDD is known and not 33, mark as online
UPDATE zoppy_customers 
SET region_type = 'online' 
WHERE region_type = 'unknown' 
  AND ddd IS NOT NULL 
  AND ddd != '' 
  AND ddd != '33';

-- Create function to merge Tiny Online duplicates into existing records
CREATE OR REPLACE FUNCTION public.merge_tiny_online_duplicates()
RETURNS TABLE(duplicates_found bigint, records_merged bigint, records_deleted bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_found bigint := 0;
  v_merged bigint := 0;
  v_deleted bigint := 0;
  rec RECORD;
BEGIN
  -- Find tiny-online records that have a name match in non-tiny records
  FOR rec IN
    SELECT 
      t.id as tiny_id,
      t.total_orders as tiny_orders,
      t.total_spent as tiny_spent,
      t.first_purchase_at as tiny_first,
      t.last_purchase_at as tiny_last,
      m.id as match_id,
      m.total_orders as match_orders,
      m.total_spent as match_spent,
      m.first_purchase_at as match_first,
      m.last_purchase_at as match_last
    FROM zoppy_customers t
    JOIN zoppy_customers m ON 
      LOWER(TRIM(COALESCE(m.first_name,'') || ' ' || COALESCE(m.last_name,''))) = 
      LOWER(TRIM(COALESCE(t.first_name,'') || ' ' || COALESCE(t.last_name,'')))
      AND m.id != t.id
      AND m.zoppy_id NOT LIKE 'tiny-online-%'
    WHERE t.zoppy_id LIKE 'tiny-online-%'
      AND TRIM(COALESCE(t.first_name,'') || ' ' || COALESCE(t.last_name,'')) != ''
  LOOP
    v_found := v_found + 1;
    
    -- Merge totals into the existing (non-tiny) record
    UPDATE zoppy_customers SET
      total_orders = COALESCE(rec.match_orders, 0) + COALESCE(rec.tiny_orders, 0),
      total_spent = COALESCE(rec.match_spent, 0) + COALESCE(rec.tiny_spent, 0),
      avg_ticket = CASE 
        WHEN (COALESCE(rec.match_orders, 0) + COALESCE(rec.tiny_orders, 0)) > 0 
        THEN (COALESCE(rec.match_spent, 0) + COALESCE(rec.tiny_spent, 0)) / (COALESCE(rec.match_orders, 0) + COALESCE(rec.tiny_orders, 0))
        ELSE 0 
      END,
      first_purchase_at = LEAST(rec.match_first, rec.tiny_first),
      last_purchase_at = GREATEST(rec.match_last, rec.tiny_last)
    WHERE id = rec.match_id;
    
    v_merged := v_merged + 1;
    
    -- Delete the tiny-online duplicate
    DELETE FROM zoppy_customers WHERE id = rec.tiny_id;
    v_deleted := v_deleted + 1;
  END LOOP;
  
  RETURN QUERY SELECT v_found, v_merged, v_deleted;
END;
$$;