-- Allow POS module users to view fiscal documents (NF-e/NFC-e)
-- Previously only admins could SELECT, which hid authorized DANFEs from store operators in production.
CREATE POLICY "POS users view fiscal_documents"
  ON public.fiscal_documents
  FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR public.has_module_access(auth.uid(), 'pos')
    OR public.has_module_access(auth.uid(), 'expedition')
  );