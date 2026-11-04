CREATE TABLE public.purchase_grade_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  sizes jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.purchase_grade_types TO authenticated;
GRANT ALL ON public.purchase_grade_types TO service_role;
ALTER TABLE public.purchase_grade_types ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff grade types" ON public.purchase_grade_types FOR ALL TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

CREATE TABLE public.purchase_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  created_by_name text
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.purchase_requests TO authenticated;
GRANT ALL ON public.purchase_requests TO service_role;
ALTER TABLE public.purchase_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff purchase requests" ON public.purchase_requests FOR ALL TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

CREATE TABLE public.purchase_request_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.purchase_requests(id) ON DELETE CASCADE,
  product_code text,
  master_id uuid,
  product_name text NOT NULL,
  color text,
  brand text,
  grade_type_id uuid REFERENCES public.purchase_grade_types(id) ON DELETE SET NULL,
  grade_name text NOT NULL,
  grade_sizes jsonb NOT NULL DEFAULT '[]'::jsonb,
  pairs_per_grade integer NOT NULL DEFAULT 0,
  grades_qty integer NOT NULL DEFAULT 1 CHECK (grades_qty > 0),
  status text NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','comprado')),
  confirmed_at timestamptz,
  confirmed_by_name text,
  expected_arrival date,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_pri_request ON public.purchase_request_items(request_id);
CREATE INDEX idx_pri_status_created ON public.purchase_request_items(status, created_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.purchase_request_items TO authenticated;
GRANT ALL ON public.purchase_request_items TO service_role;
ALTER TABLE public.purchase_request_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff purchase items" ON public.purchase_request_items FOR ALL TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

CREATE TABLE public.purchase_request_item_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES public.purchase_request_items(id) ON DELETE CASCADE,
  added_grades integer NOT NULL,
  previous_qty integer NOT NULL,
  new_qty integer NOT NULL,
  changed_by_name text,
  changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_pric_item ON public.purchase_request_item_changes(item_id);
GRANT SELECT, INSERT ON public.purchase_request_item_changes TO authenticated;
GRANT ALL ON public.purchase_request_item_changes TO service_role;
ALTER TABLE public.purchase_request_item_changes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff item changes read" ON public.purchase_request_item_changes FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);

CREATE OR REPLACE FUNCTION public.purchase_item_add_grades(p_item_id uuid, p_add integer, p_by text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_old integer; v_new integer;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF p_add IS NULL OR p_add <= 0 THEN RAISE EXCEPTION 'quantidade inválida'; END IF;
  SELECT grades_qty INTO v_old FROM purchase_request_items WHERE id = p_item_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'item não encontrado'; END IF;
  v_new := v_old + p_add;
  UPDATE purchase_request_items SET grades_qty = v_new WHERE id = p_item_id;
  INSERT INTO purchase_request_item_changes(item_id, added_grades, previous_qty, new_qty, changed_by_name)
  VALUES (p_item_id, p_add, v_old, v_new, p_by);
  RETURN v_new;
END $$;

CREATE OR REPLACE FUNCTION public.purchase_item_set_status(p_item_id uuid, p_confirm boolean, p_by text, p_arrival date)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF p_confirm THEN
    UPDATE purchase_request_items SET status='comprado', confirmed_at=now(), confirmed_by_name=p_by, expected_arrival=p_arrival
    WHERE id=p_item_id AND status='pendente';
  ELSE
    UPDATE purchase_request_items SET status='pendente', confirmed_at=NULL, confirmed_by_name=NULL
    WHERE id=p_item_id AND status='comprado';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.purchase_item_block_delete_confirmed()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF OLD.status = 'comprado' THEN RAISE EXCEPTION 'Item já comprado não pode ser removido'; END IF;
  RETURN OLD;
END $$;
CREATE TRIGGER trg_purchase_item_block_delete BEFORE DELETE ON public.purchase_request_items
FOR EACH ROW EXECUTE FUNCTION public.purchase_item_block_delete_confirmed();

REVOKE EXECUTE ON FUNCTION public.purchase_item_add_grades(uuid,integer,text) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.purchase_item_set_status(uuid,boolean,text,date) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.purchase_item_add_grades(uuid,integer,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.purchase_item_set_status(uuid,boolean,text,date) TO authenticated;