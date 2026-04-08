
CREATE TABLE public.quick_replies (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  category TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.quick_replies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view all quick replies"
  ON public.quick_replies FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can create quick replies"
  ON public.quick_replies FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update quick replies"
  ON public.quick_replies FOR UPDATE
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can delete quick replies"
  ON public.quick_replies FOR DELETE
  TO authenticated
  USING (true);

CREATE TRIGGER update_quick_replies_updated_at
  BEFORE UPDATE ON public.quick_replies
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
