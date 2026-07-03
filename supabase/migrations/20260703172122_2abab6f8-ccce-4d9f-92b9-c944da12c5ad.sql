CREATE TABLE public.pos_products_dedup_backup (LIKE public.pos_products INCLUDING DEFAULTS);
ALTER TABLE public.pos_products_dedup_backup
  ADD COLUMN backup_id uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN dedup_wave text,
  ADD COLUMN group_role text,
  ADD COLUMN backed_up_at timestamptz NOT NULL DEFAULT now();
GRANT ALL ON public.pos_products_dedup_backup TO service_role;
ALTER TABLE public.pos_products_dedup_backup ENABLE ROW LEVEL SECURITY;