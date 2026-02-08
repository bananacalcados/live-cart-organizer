-- Tighten RLS for mapping table (avoid permissive policies)
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public'
      AND tablename = 'shopify_yampi_mapping'
      AND policyname = 'Allow all access to shopify_yampi_mapping'
  ) THEN
    EXECUTE 'DROP POLICY "Allow all access to shopify_yampi_mapping" ON public.shopify_yampi_mapping';
  END IF;
END $$;

-- Keep RLS enabled; with no policies, table is not accessible from the client.
ALTER TABLE public.shopify_yampi_mapping ENABLE ROW LEVEL SECURITY;