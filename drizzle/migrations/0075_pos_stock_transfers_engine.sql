CREATE SEQUENCE IF NOT EXISTS public.pos_stock_transfer_numero_seq;

CREATE TABLE public.pos_stock_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  numero bigint NOT NULL UNIQUE DEFAULT nextval('public.pos_stock_transfer_numero_seq'),
  from_store_id uuid NOT NULL REFERENCES public.pos_stores(id),
  to_store_id uuid NOT NULL REFERENCES public.pos_stores(id),
  status text NOT NULL DEFAULT 'concluida' CHECK (status IN ('concluida','estornada')),
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  total_items integer NOT NULL DEFAULT 0,
  notes text,
  created_by uuid,
  created_by_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  reversed_of uuid REFERENCES public.pos_stock_transfers(id),
  reversed_by_transfer uuid REFERENCES public.pos_stock_transfers(id),
  reversed_at timestamptz,
  reverse_reason text,
  idempotency_key text NOT NULL UNIQUE
);
CREATE INDEX idx_pos_stock_transfers_from ON public.pos_stock_transfers (from_store_id, created_at DESC);
CREATE INDEX idx_pos_stock_transfers_to ON public.pos_stock_transfers (to_store_id, created_at DESC);

GRANT SELECT ON public.pos_stock_transfers TO authenticated;
GRANT ALL ON public.pos_stock_transfers TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.pos_stock_transfer_numero_seq TO service_role;
ALTER TABLE public.pos_stock_transfers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Autenticados leem transferências" ON public.pos_stock_transfers FOR SELECT TO authenticated USING (true);

CREATE OR REPLACE FUNCTION public.pos_transfer_find_dest(p_src_id uuid, p_to uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH s AS (SELECT * FROM public.pos_products WHERE id = p_src_id)
  SELECT COALESCE(
    (SELECT d.id FROM public.pos_products d, s
      WHERE d.store_id = p_to AND NULLIF(btrim(s.barcode),'') IS NOT NULL AND d.barcode = s.barcode
      ORDER BY d.is_active DESC, d.stock DESC, d.id LIMIT 1),
    (SELECT d.id FROM public.pos_products d, s
      WHERE d.store_id = p_to AND NULLIF(btrim(s.parent_sku),'') IS NOT NULL AND d.parent_sku = s.parent_sku
        AND lower(btrim(COALESCE(d.color,''))) = lower(btrim(COALESCE(s.color,'')))
        AND lower(btrim(COALESCE(d.size,''))) = lower(btrim(COALESCE(s.size,'')))
      ORDER BY d.is_active DESC, d.stock DESC, d.id LIMIT 1),
    (SELECT d.id FROM public.pos_products d, s
      WHERE d.store_id = p_to AND NULLIF(btrim(s.sku),'') IS NOT NULL AND d.sku = s.sku
      ORDER BY d.is_active DESC, d.stock DESC, d.id LIMIT 1)
  )
$$;

CREATE OR REPLACE FUNCTION public.pos_transfer_stock(
  p_from uuid, p_to uuid, p_items jsonb, p_notes text, p_user_id uuid, p_user_name text,
  p_idempotency_key text, p_dry_run boolean DEFAULT false
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_existing public.pos_stock_transfers%ROWTYPE;
  v_from_name text; v_to_name text;
  r record; v_src public.pos_products%ROWTYPE;
  v_dst_id uuid; v_dst_stock numeric;
  v_errors text[] := '{}';
  v_plan jsonb := '[]'::jsonb;
  v_out jsonb := '[]'::jsonb;
  p jsonb;
  v_id uuid; v_num bigint; v_label text; v_reason text;
  v_total int := 0; v_n int; v_ids uuid[]; v_qty int; v_src_before numeric;
BEGIN
  IF p_from IS NULL OR p_to IS NULL OR p_from = p_to THEN
    RAISE EXCEPTION 'Origem e destino precisam ser lojas diferentes';
  END IF;
  IF NOT p_dry_run AND COALESCE(btrim(p_idempotency_key),'') = '' THEN
    RAISE EXCEPTION 'Chave de idempotência obrigatória';
  END IF;

  IF NOT p_dry_run THEN
    SELECT * INTO v_existing FROM public.pos_stock_transfers WHERE idempotency_key = p_idempotency_key;
    IF FOUND THEN
      RETURN jsonb_build_object('ok', true, 'duplicate', true, 'id', v_existing.id, 'numero', v_existing.numero,
        'label', 'T-' || lpad(v_existing.numero::text, 6, '0'), 'status', v_existing.status,
        'from_store_id', v_existing.from_store_id, 'to_store_id', v_existing.to_store_id,
        'created_at', v_existing.created_at, 'created_by_name', v_existing.created_by_name,
        'total_items', v_existing.total_items, 'items', v_existing.items);
    END IF;
  END IF;

  SELECT name INTO v_from_name FROM public.pos_stores WHERE id = p_from AND is_active AND NOT is_simulation;
  IF v_from_name IS NULL THEN RAISE EXCEPTION 'Loja de origem inválida ou inativa'; END IF;
  SELECT name INTO v_to_name FROM public.pos_stores WHERE id = p_to AND is_active AND NOT is_simulation;
  IF v_to_name IS NULL THEN RAISE EXCEPTION 'Loja de destino inválida ou inativa'; END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN RAISE EXCEPTION 'Lista de itens inválida'; END IF;
  v_n := jsonb_array_length(p_items);
  IF v_n < 1 OR v_n > 200 THEN RAISE EXCEPTION 'A transferência precisa ter de 1 a 200 itens'; END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_items) x
    WHERE COALESCE(x->>'pos_product_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       OR COALESCE(x->>'quantity','') !~ '^[0-9]{1,6}$'
       OR (x->>'quantity')::int <= 0
  ) THEN
    RAISE EXCEPTION 'Itens inválidos: cada item precisa de produto e quantidade inteira maior que zero';
  END IF;

  -- Trava origem + destinos já existentes numa única ordem (por id) para evitar deadlock
  IF NOT p_dry_run THEN
    SELECT array_agg(DISTINCT u ORDER BY u) INTO v_ids FROM (
      SELECT (x->>'pos_product_id')::uuid u FROM jsonb_array_elements(p_items) x
      UNION
      SELECT public.pos_transfer_find_dest((x->>'pos_product_id')::uuid, p_to) FROM jsonb_array_elements(p_items) x
    ) z WHERE u IS NOT NULL;
    PERFORM 1 FROM public.pos_products WHERE id = ANY(v_ids) ORDER BY id FOR UPDATE;
  END IF;

  FOR r IN
    SELECT (x->>'pos_product_id')::uuid AS pid, SUM((x->>'quantity')::int)::int AS qty
    FROM jsonb_array_elements(p_items) x GROUP BY 1 ORDER BY 1
  LOOP
    SELECT * INTO v_src FROM public.pos_products WHERE id = r.pid;
    IF NOT FOUND OR v_src.store_id <> p_from THEN
      v_errors := v_errors || format('Produto %s não está no estoque da %s', r.pid, v_from_name);
      CONTINUE;
    END IF;
    IF COALESCE(v_src.stock,0) < r.qty THEN
      v_errors := v_errors || format('%s (tam %s): saldo %s, pedido %s', v_src.name, COALESCE(NULLIF(v_src.size,''),'-'), COALESCE(v_src.stock,0)::numeric(12,0), r.qty);
      CONTINUE;
    END IF;
    v_dst_id := public.pos_transfer_find_dest(r.pid, p_to);
    SELECT stock INTO v_dst_stock FROM public.pos_products WHERE id = v_dst_id;
    v_total := v_total + r.qty;
    v_plan := v_plan || jsonb_build_object(
      'pos_product_id_origem', v_src.id, 'pos_product_id_destino', v_dst_id,
      'destino_sera_criado', v_dst_id IS NULL,
      'barcode', v_src.barcode, 'sku', v_src.sku, 'parent_sku', v_src.parent_sku,
      'name', v_src.name, 'size', v_src.size, 'color', v_src.color, 'image_url', v_src.image_url,
      'quantity', r.qty,
      'origem_antes', COALESCE(v_src.stock,0), 'origem_depois', COALESCE(v_src.stock,0) - r.qty,
      'destino_antes', COALESCE(v_dst_stock,0), 'destino_depois', COALESCE(v_dst_stock,0) + r.qty);
  END LOOP;

  IF array_length(v_errors,1) > 0 THEN
    IF p_dry_run THEN
      RETURN jsonb_build_object('ok', false, 'dry_run', true, 'errors', to_jsonb(v_errors), 'items', v_plan);
    END IF;
    RAISE EXCEPTION 'Nada foi transferido. Saldo insuficiente: %', array_to_string(v_errors, '; ');
  END IF;

  IF p_dry_run THEN
    RETURN jsonb_build_object('ok', true, 'dry_run', true, 'from_store_id', p_from, 'to_store_id', p_to,
      'from_store_name', v_from_name, 'to_store_name', v_to_name, 'total_items', v_total, 'items', v_plan, 'errors', '[]'::jsonb);
  END IF;

  v_num := nextval('public.pos_stock_transfer_numero_seq');
  v_label := 'T-' || lpad(v_num::text, 6, '0');
  v_reason := format('Transferência %s (%s → %s)', v_label, v_from_name, v_to_name);
  INSERT INTO public.pos_stock_transfers (numero, from_store_id, to_store_id, status, items, total_items, notes,
    created_by, created_by_name, idempotency_key)
  VALUES (v_num, p_from, p_to, 'concluida', '[]'::jsonb, v_total, NULLIF(btrim(COALESCE(p_notes,'')),''),
    p_user_id, p_user_name, p_idempotency_key)
  RETURNING id INTO v_id;

  FOR p IN SELECT * FROM jsonb_array_elements(v_plan) LOOP
    v_qty := (p->>'quantity')::int;
    SELECT * INTO v_src FROM public.pos_products WHERE id = (p->>'pos_product_id_origem')::uuid;
    v_src_before := COALESCE(v_src.stock,0);
    IF v_src_before < v_qty THEN
      RAISE EXCEPTION 'Nada foi transferido. Saldo insuficiente: % (tam %): saldo %, pedido %', v_src.name, COALESCE(v_src.size,'-'), v_src_before, v_qty;
    END IF;

    v_dst_id := public.pos_transfer_find_dest(v_src.id, p_to);
    IF v_dst_id IS NULL THEN
      INSERT INTO public.pos_products (store_id, sku, name, variant, size, color, category, price, barcode, stock,
        image_url, is_active, cost_price, parent_sku, category_id, gender, age_group, brand, brand_source,
        category_source, gender_source)
      VALUES (p_to, v_src.sku, v_src.name, v_src.variant, v_src.size, v_src.color, v_src.category, v_src.price,
        v_src.barcode, 0, v_src.image_url, true, v_src.cost_price, v_src.parent_sku, v_src.category_id,
        v_src.gender, v_src.age_group, v_src.brand, v_src.brand_source, v_src.category_source, v_src.gender_source)
      RETURNING id INTO v_dst_id;
      v_dst_stock := 0;
    ELSE
      SELECT COALESCE(stock,0) INTO v_dst_stock FROM public.pos_products WHERE id = v_dst_id FOR UPDATE;
    END IF;

    -- Ajustes oficiais ANTES do update (evita a blindagem automática)
    INSERT INTO public.pos_stock_adjustments (store_id, product_id, sku, barcode, product_name, direction, quantity,
      previous_stock, new_stock, reason, movement_type, user_id, user_name)
    VALUES
      (p_from, v_src.id, v_src.sku, v_src.barcode, COALESCE(v_src.name,'—'), 'out', v_qty,
        v_src_before, v_src_before - v_qty, v_reason, 'transferencia', p_user_id, p_user_name),
      (p_to, v_dst_id, v_src.sku, v_src.barcode, COALESCE(v_src.name,'—'), 'in', v_qty,
        v_dst_stock, v_dst_stock + v_qty, v_reason, 'transferencia', p_user_id, p_user_name);

    UPDATE public.pos_products SET stock = stock - v_qty WHERE id = v_src.id AND stock >= v_qty;
    IF NOT FOUND THEN RAISE EXCEPTION 'Nada foi transferido. Saldo mudou durante a transferência: %', v_src.name; END IF;
    UPDATE public.pos_products SET stock = stock + v_qty WHERE id = v_dst_id;

    v_out := v_out || (p || jsonb_build_object('pos_product_id_destino', v_dst_id,
      'origem_antes', v_src_before, 'origem_depois', v_src_before - v_qty,
      'destino_antes', v_dst_stock, 'destino_depois', v_dst_stock + v_qty));
  END LOOP;

  UPDATE public.pos_stock_transfers SET items = v_out WHERE id = v_id;

  RETURN jsonb_build_object('ok', true, 'duplicate', false, 'id', v_id, 'numero', v_num, 'label', v_label,
    'status', 'concluida', 'from_store_id', p_from, 'to_store_id', p_to,
    'from_store_name', v_from_name, 'to_store_name', v_to_name, 'created_at', now(),
    'created_by_name', p_user_name, 'total_items', v_total, 'items', v_out);
END
$$;

CREATE OR REPLACE FUNCTION public.pos_reverse_stock_transfer(p_transfer_id uuid, p_user_id uuid, p_user_name text, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_t public.pos_stock_transfers%ROWTYPE;
  v_items jsonb; v_res jsonb; v_label text;
BEGIN
  IF p_user_id IS NULL OR NOT public.has_role(p_user_id, 'admin') THEN
    RAISE EXCEPTION 'Somente administradores podem estornar transferências';
  END IF;
  IF COALESCE(btrim(p_reason),'') = '' THEN RAISE EXCEPTION 'Informe o motivo do estorno'; END IF;
  SELECT * INTO v_t FROM public.pos_stock_transfers WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Transferência não encontrada'; END IF;
  IF v_t.reversed_of IS NOT NULL THEN RAISE EXCEPTION 'Esta transferência já é um estorno'; END IF;
  IF v_t.status = 'estornada' THEN RAISE EXCEPTION 'Transferência já estornada'; END IF;
  v_label := 'T-' || lpad(v_t.numero::text, 6, '0');
  SELECT jsonb_agg(jsonb_build_object('pos_product_id', i->>'pos_product_id_destino', 'quantity', (i->>'quantity')::int))
    INTO v_items FROM jsonb_array_elements(v_t.items) i;
  v_res := public.pos_transfer_stock(v_t.to_store_id, v_t.from_store_id, v_items,
    format('Estorno de %s: %s', v_label, btrim(p_reason)), p_user_id, p_user_name, 'reverse:' || v_t.id::text, false);
  UPDATE public.pos_stock_transfers SET reversed_of = v_t.id WHERE id = (v_res->>'id')::uuid;
  UPDATE public.pos_stock_transfers SET status = 'estornada', reversed_by_transfer = (v_res->>'id')::uuid,
    reversed_at = now(), reverse_reason = btrim(p_reason) WHERE id = v_t.id;
  RETURN v_res || jsonb_build_object('reversed_of', v_t.id);
END
$$;

REVOKE ALL ON FUNCTION public.pos_transfer_find_dest(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pos_transfer_stock(uuid, uuid, jsonb, text, uuid, text, text, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pos_reverse_stock_transfer(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pos_transfer_find_dest(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.pos_transfer_stock(uuid, uuid, jsonb, text, uuid, text, text, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.pos_reverse_stock_transfer(uuid, uuid, text, text) TO service_role;