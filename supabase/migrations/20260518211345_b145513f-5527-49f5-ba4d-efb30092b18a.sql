
CREATE TABLE public.sticky_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  content JSONB NOT NULL DEFAULT '{}'::jsonb,
  bg_color TEXT NOT NULL DEFAULT '#FEF3C7',
  text_color TEXT NOT NULL DEFAULT '#1F2937',
  position_x INTEGER NOT NULL DEFAULT 40,
  position_y INTEGER NOT NULL DEFAULT 120,
  width INTEGER NOT NULL DEFAULT 280,
  height INTEGER NOT NULL DEFAULT 280,
  z_index INTEGER NOT NULL DEFAULT 1,
  deadline TIMESTAMPTZ,
  is_shared BOOLEAN NOT NULL DEFAULT false,
  is_done BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_sticky_notes_user ON public.sticky_notes(user_id);
CREATE INDEX idx_sticky_notes_shared ON public.sticky_notes(is_shared) WHERE is_shared = true;

ALTER TABLE public.sticky_notes ENABLE ROW LEVEL SECURITY;

-- Only admins can use sticky notes at all
CREATE POLICY "Admin can view own + shared sticky notes"
ON public.sticky_notes FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  AND (user_id = auth.uid() OR is_shared = true)
);

CREATE POLICY "Admin can insert own sticky notes"
ON public.sticky_notes FOR INSERT
TO authenticated
WITH CHECK (
  public.has_role(auth.uid(), 'admin')
  AND user_id = auth.uid()
);

CREATE POLICY "Admin can update own sticky notes"
ON public.sticky_notes FOR UPDATE
TO authenticated
USING (public.has_role(auth.uid(), 'admin') AND user_id = auth.uid())
WITH CHECK (public.has_role(auth.uid(), 'admin') AND user_id = auth.uid());

CREATE POLICY "Admin can delete own sticky notes"
ON public.sticky_notes FOR DELETE
TO authenticated
USING (public.has_role(auth.uid(), 'admin') AND user_id = auth.uid());

CREATE TRIGGER sticky_notes_set_updated_at
BEFORE UPDATE ON public.sticky_notes
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();
