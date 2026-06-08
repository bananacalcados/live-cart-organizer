ALTER TABLE public.purchase_invoice_items
  ADD COLUMN IF NOT EXISTS linked_parent_sku text,
  ADD COLUMN IF NOT EXISTS linked_store_id uuid,
  ADD COLUMN IF NOT EXISTS linked_at timestamptz;