-- Add parent_id to support 1-level subfolders
ALTER TABLE public.quick_reply_folders
ADD COLUMN parent_id uuid REFERENCES public.quick_reply_folders(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_quick_reply_folders_parent_id 
ON public.quick_reply_folders(parent_id);

-- Enforce maximum 1 level of nesting (a subfolder cannot have its own subfolders)
CREATE OR REPLACE FUNCTION public.enforce_quick_reply_folder_depth()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.parent_id IS NOT NULL THEN
    -- The parent must itself be a root folder (no grandparent)
    IF EXISTS (
      SELECT 1 FROM public.quick_reply_folders
      WHERE id = NEW.parent_id AND parent_id IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'Quick reply folders support only 1 level of nesting (parent must be a root folder)';
    END IF;
    -- Cannot be its own parent
    IF NEW.parent_id = NEW.id THEN
      RAISE EXCEPTION 'A folder cannot be its own parent';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_quick_reply_folder_depth ON public.quick_reply_folders;
CREATE TRIGGER trg_quick_reply_folder_depth
BEFORE INSERT OR UPDATE ON public.quick_reply_folders
FOR EACH ROW
EXECUTE FUNCTION public.enforce_quick_reply_folder_depth();