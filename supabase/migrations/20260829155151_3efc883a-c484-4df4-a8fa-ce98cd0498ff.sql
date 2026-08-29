CREATE TABLE public.order_tags (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#6366f1',
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX order_tags_name_uniq ON public.order_tags (lower(name));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.order_tags TO authenticated;
GRANT ALL ON public.order_tags TO service_role;
ALTER TABLE public.order_tags ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can manage order tags" ON public.order_tags FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TABLE public.order_tag_assignments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  tag_id UUID NOT NULL REFERENCES public.order_tags(id) ON DELETE CASCADE,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (order_id, tag_id)
);
CREATE INDEX order_tag_assignments_order_idx ON public.order_tag_assignments (order_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.order_tag_assignments TO authenticated;
GRANT ALL ON public.order_tag_assignments TO service_role;
ALTER TABLE public.order_tag_assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can manage order tag assignments" ON public.order_tag_assignments FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TRIGGER update_order_tags_updated_at BEFORE UPDATE ON public.order_tags FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();