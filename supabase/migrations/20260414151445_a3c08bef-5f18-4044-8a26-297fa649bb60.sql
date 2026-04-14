-- Execute the merge function to clean up existing Tiny Online duplicates
DO $$
DECLARE
  rec RECORD;
  v_merged int := 0;
BEGIN
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
    UPDATE zoppy_customers SET
      total_orders = COALESCE(rec.match_orders, 0) + COALESCE(rec.tiny_orders, 0),
      total_spent = COALESCE(rec.match_spent, 0) + COALESCE(rec.tiny_spent, 0),
      avg_ticket = CASE 
        WHEN (COALESCE(rec.match_orders, 0) + COALESCE(rec.tiny_orders, 0)) > 0 
        THEN (COALESCE(rec.match_spent, 0) + COALESCE(rec.tiny_spent, 0)) / (COALESCE(rec.match_orders, 0) + COALESCE(rec.tiny_orders, 0))
        ELSE 0 END,
      first_purchase_at = LEAST(rec.match_first, rec.tiny_first),
      last_purchase_at = GREATEST(rec.match_last, rec.tiny_last)
    WHERE id = rec.match_id;
    
    DELETE FROM zoppy_customers WHERE id = rec.tiny_id;
    v_merged := v_merged + 1;
  END LOOP;
  
  RAISE NOTICE 'Merged and deleted % Tiny Online duplicates', v_merged;
END $$;