-- Fase 1: Pastas para mensagens rápidas

CREATE TABLE IF NOT EXISTS public.quick_reply_folders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  color text NOT NULL DEFAULT 'bg-blue-500',
  sort_order integer NOT NULL DEFAULT 0,
  created_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.quick_reply_folders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Auth can view folders"
  ON public.quick_reply_folders FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Auth can insert folders"
  ON public.quick_reply_folders FOR INSERT
  TO authenticated WITH CHECK (true);

CREATE POLICY "Auth can update folders"
  ON public.quick_reply_folders FOR UPDATE
  TO authenticated USING (true);

CREATE POLICY "Auth can delete folders"
  ON public.quick_reply_folders FOR DELETE
  TO authenticated USING (true);

CREATE TRIGGER set_quick_reply_folders_updated_at
  BEFORE UPDATE ON public.quick_reply_folders
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Adiciona folder_id na tabela existente (nullable: mensagens sem pasta continuam ok)
ALTER TABLE public.quick_replies
  ADD COLUMN IF NOT EXISTS folder_id uuid REFERENCES public.quick_reply_folders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_quick_replies_folder_id ON public.quick_replies(folder_id);