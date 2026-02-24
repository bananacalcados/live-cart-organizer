
-- Add unique constraint to prevent future seller duplicates
ALTER TABLE pos_sellers 
  ADD CONSTRAINT pos_sellers_store_tiny_unique 
  UNIQUE (store_id, tiny_seller_id);
