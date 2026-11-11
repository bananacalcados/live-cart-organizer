ALTER TABLE public.exchange_requests
  ADD COLUMN IF NOT EXISTS assigned_to uuid,
  ADD COLUMN IF NOT EXISTS assigned_at timestamptz,
  ADD COLUMN IF NOT EXISTS decided_by uuid,
  ADD COLUMN IF NOT EXISTS decided_at timestamptz,
  ADD COLUMN IF NOT EXISTS decision_reason text,
  ADD COLUMN IF NOT EXISTS desk_info_requested_at timestamptz;

CREATE INDEX IF NOT EXISTS exchange_requests_desk_idx ON public.exchange_requests (status, created_at);

CREATE TABLE public.exchange_request_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.exchange_requests(id) ON DELETE CASCADE,
  actor uuid,
  actor_name text,
  action text NOT NULL,
  from_status text,
  to_status text,
  reason text,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX exchange_request_events_req_idx ON public.exchange_request_events (request_id, created_at);
GRANT SELECT ON public.exchange_request_events TO authenticated;
GRANT ALL ON public.exchange_request_events TO service_role;
ALTER TABLE public.exchange_request_events ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.exchange_message_templates (
  key text PRIMARY KEY,
  title text NOT NULL,
  body text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);
GRANT SELECT, UPDATE ON public.exchange_message_templates TO authenticated;
GRANT ALL ON public.exchange_message_templates TO service_role;
ALTER TABLE public.exchange_message_templates ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public._exchange_desk_staff(p_uid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT p_uid IS NOT NULL AND (public.has_role(p_uid,'admin') OR public.has_module_access(p_uid,'pos') OR public.has_module_access(p_uid,'expedition') OR public.has_module_access(p_uid,'management'))
$$;
REVOKE ALL ON FUNCTION public._exchange_desk_staff(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._exchange_desk_staff(uuid) TO authenticated, service_role;

CREATE POLICY "Staff reads exchange history" ON public.exchange_request_events FOR SELECT TO authenticated USING (public._exchange_desk_staff(auth.uid()));
CREATE POLICY "Staff reads exchange templates" ON public.exchange_message_templates FOR SELECT TO authenticated USING (public._exchange_desk_staff(auth.uid()));
CREATE POLICY "Admin edits exchange templates" ON public.exchange_message_templates FOR UPDATE TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE OR REPLACE FUNCTION public.exchange_desk_list(p_tab text, p_type text DEFAULT NULL, p_reason text DEFAULT NULL, p_assignee uuid DEFAULT NULL, p_search text DEFAULT NULL, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE d text := regexp_replace(coalesce(p_search,''),'\D','','g'); s text := trim(coalesce(p_search,'')); r jsonb;
BEGIN
  IF NOT public._exchange_desk_staff(auth.uid()) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF length(s) > 100 OR p_offset < 0 OR p_offset > 10000 THEN RETURN '[]'::jsonb; END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.created_at, x.id), '[]'::jsonb) INTO r FROM (
    SELECT e.id, e.request_type, split_part(coalesce(e.customer_name,''),' ',1) AS first_name, e.phone, e.order_ref, e.order_number,
      e.product_name, e.product_size, e.desired_size, e.requested_quantity, e.reason_category::text AS reason, e.status::text AS status,
      e.escalated_reason, e.created_at, e.assigned_to, e.reverse_shipping_code, e.trocas_devolucoes_id
    FROM exchange_requests e
    WHERE CASE p_tab
        WHEN 'precisa' THEN e.status = 'escalado' OR (e.status = 'aprovado' AND e.reverse_shipping_code IS NULL)
        WHEN 'andamento' THEN e.status IN ('solicitado','aguardando_postagem','em_transito','recebido') OR (e.status = 'aprovado' AND e.reverse_shipping_code IS NOT NULL)
        WHEN 'concluidas' THEN e.status IN ('concluido','recusado','cancelado')
        ELSE false END
      AND (p_type IS NULL OR e.request_type = p_type)
      AND (p_reason IS NULL OR e.reason_category::text = p_reason)
      AND (p_assignee IS NULL OR e.assigned_to = p_assignee)
      AND (s = '' OR e.customer_name ILIKE '%'||s||'%' OR e.order_ref ILIKE '%'||s||'%' OR e.order_number ILIKE '%'||s||'%'
           OR (length(d) >= 4 AND regexp_replace(e.phone,'\D','','g') LIKE '%'||d||'%'))
    ORDER BY e.created_at, e.id
    LIMIT least(greatest(coalesce(p_limit,50),1),200) OFFSET p_offset) x;
  RETURN r;
END $$;
REVOKE ALL ON FUNCTION public.exchange_desk_list(text,text,text,uuid,text,integer,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.exchange_desk_list(text,text,text,uuid,text,integer,integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.exchange_desk_count() RETURNS integer
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE n integer;
BEGIN
  IF NOT public._exchange_desk_staff(auth.uid()) THEN RETURN 0; END IF;
  SELECT count(*) INTO n FROM exchange_requests WHERE status = 'escalado' OR (status = 'aprovado' AND reverse_shipping_code IS NULL);
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.exchange_desk_count() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.exchange_desk_count() TO authenticated;

CREATE OR REPLACE FUNCTION public.exchange_desk_detail(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE e record; s record; sim record; key8 text; r jsonb;
BEGIN
  IF NOT public._exchange_desk_staff(auth.uid()) THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT * INTO e FROM exchange_requests WHERE id = p_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT id, store_id, customer_name, customer_phone, total, created_at, external_order_id INTO s FROM pos_sales WHERE id = e.sale_id;
  SELECT delivered_at, delivered_source, real_carrier INTO sim FROM shipment_simulations WHERE sale_id = e.sale_id AND merged_into_id IS NULL ORDER BY created_at DESC LIMIT 1;
  key8 := right(regexp_replace(coalesce(e.phone,''),'\D','','g'), 8);
  r := jsonb_build_object(
    'request', to_jsonb(e),
    'sale', CASE WHEN s.id IS NULL THEN NULL ELSE jsonb_build_object('id',s.id,'store_id',s.store_id,'store_name',(SELECT name FROM pos_stores WHERE id=s.store_id),'customer_name',s.customer_name,'customer_phone',s.customer_phone,'total',s.total,'created_at',s.created_at,'external_order_id',s.external_order_id) END,
    'items', (SELECT coalesce(jsonb_agg(jsonb_build_object('id',i.id,'product_name',i.product_name,'size',i.size,'sku',i.sku,'barcode',i.barcode,'quantity',i.quantity,'unit_price',i.unit_price) ORDER BY i.created_at),'[]') FROM pos_sale_items i WHERE i.sale_id = e.sale_id),
    'delivery', jsonb_build_object('delivered_at', coalesce(e.delivered_at_used, sim.delivered_at), 'source', coalesce(e.delivered_source, sim.delivered_source), 'customer_reported_at', e.customer_reported_received_at, 'carrier', sim.real_carrier),
    'history', (SELECT coalesce(jsonb_agg(to_jsonb(h) ORDER BY h.created_at),'[]') FROM exchange_request_events h WHERE h.request_id = e.id),
    'previous', (SELECT coalesce(jsonb_agg(jsonb_build_object('id',o.id,'type',o.request_type,'status',o.status,'created_at',o.created_at,'product_name',o.product_name) ORDER BY o.created_at DESC),'[]') FROM (SELECT * FROM exchange_requests o WHERE o.id <> e.id AND length(key8)=8 AND right(regexp_replace(o.phone,'\D','','g'),8) = key8 ORDER BY o.created_at DESC LIMIT 20) o),
    'previous_legacy', (SELECT count(*) FROM trocas_devolucoes t JOIN pos_sales ps ON ps.id = t.pedido_original_id WHERE length(key8)=8 AND ps.phone_suffix8 = key8 AND (e.trocas_devolucoes_id IS NULL OR t.id <> e.trocas_devolucoes_id)),
    'nfe_devolucao', (SELECT jsonb_build_object('status',f.status,'numero',f.numero,'chave',f.chave_acesso) FROM fiscal_documents f WHERE e.trocas_devolucoes_id IS NOT NULL AND f.troca_devolucao_id = e.trocas_devolucoes_id AND f.finalidade = 4 ORDER BY f.created_at DESC LIMIT 1),
    'troca', (SELECT jsonb_build_object('id',t.id,'codigo',t.codigo_devolucao,'status',t.status,'codigo_postagem_reversa',t.codigo_postagem_reversa) FROM trocas_devolucoes t WHERE t.id = e.trocas_devolucoes_id),
    'replacement', (SELECT jsonb_build_object('id',p.id,'name',p.name,'size',p.size,'sku',p.sku,'barcode',p.barcode,'price',p.price) FROM pos_products p WHERE p.id = e.replacement_product_id)
  );
  RETURN r;
END $$;
REVOKE ALL ON FUNCTION public.exchange_desk_detail(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.exchange_desk_detail(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.exchange_desk_sizes(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE e record; i record; base record; r jsonb;
BEGIN
  IF NOT public._exchange_desk_staff(auth.uid()) THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT * INTO e FROM exchange_requests WHERE id = p_id;
  IF NOT FOUND THEN RETURN '[]'::jsonb; END IF;
  SELECT * INTO i FROM pos_sale_items WHERE id = e.original_item_id;
  IF NOT FOUND THEN RETURN '[]'::jsonb; END IF;
  SELECT * INTO base FROM pos_products WHERE store_id = (SELECT store_id FROM pos_sales WHERE id = i.sale_id) AND sku = i.sku ORDER BY id LIMIT 1;
  IF NOT FOUND THEN RETURN '[]'::jsonb; END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.size, x.id),'[]') INTO r FROM (
    SELECT p.id, p.name, p.size, p.color, p.stock - coalesce(res.qty,0) AS available
    FROM pos_products p LEFT JOIN LATERAL (SELECT sum(replacement_reserved_quantity) qty FROM exchange_requests rr WHERE rr.replacement_product_id = p.id AND rr.status NOT IN ('concluido','cancelado','recusado')) res ON true
    WHERE p.store_id = base.store_id AND ((base.parent_sku IS NOT NULL AND p.parent_sku = base.parent_sku) OR p.name = base.name)
      AND p.stock - coalesce(res.qty,0) > 0 AND p.id <> base.id
    ORDER BY p.size, p.id LIMIT 60) x;
  RETURN r;
END $$;
REVOKE ALL ON FUNCTION public.exchange_desk_sizes(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.exchange_desk_sizes(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.exchange_desk_action(p_id uuid, p_action text, p_reason text DEFAULT NULL, p_note text DEFAULT NULL, p_assignee uuid DEFAULT NULL, p_code text DEFAULT NULL, p_troca_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE uid uuid := auth.uid(); e record; newst text; nm text; rs text := nullif(trim(coalesce(p_reason,'')),''); nt text := nullif(trim(coalesce(p_note,'')),'');
BEGIN
  IF NOT public._exchange_desk_staff(uid) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF length(coalesce(rs,'')) > 300 OR length(coalesce(nt,'')) > 1000 THEN RAISE EXCEPTION 'Texto muito longo'; END IF;
  SELECT * INTO e FROM exchange_requests WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Solicitação não encontrada'; END IF;
  SELECT coalesce(raw_user_meta_data->>'full_name', raw_user_meta_data->>'name', email) INTO nm FROM auth.users WHERE id = uid;
  newst := e.status::text;
  IF p_action = 'assign' THEN
    UPDATE exchange_requests SET assigned_to = coalesce(p_assignee, uid), assigned_at = now(), updated_at = now() WHERE id = p_id;
  ELSIF p_action = 'approve' THEN
    IF e.status <> 'escalado' THEN RAISE EXCEPTION 'Só dá para aprovar solicitação que está com o atendente'; END IF;
    IF rs IS NULL OR length(rs) < 3 THEN RAISE EXCEPTION 'Informe o motivo da aprovação'; END IF;
    newst := 'aprovado';
    UPDATE exchange_requests SET status = 'aprovado', requires_human_review = false, decided_by = uid, decided_at = now(), decision_reason = rs, reviewed_by = nm, reviewed_at = now(), updated_at = now() WHERE id = p_id;
  ELSIF p_action = 'deny' THEN
    IF e.status NOT IN ('escalado','solicitado') THEN RAISE EXCEPTION 'Esta solicitação não pode mais ser negada'; END IF;
    IF rs IS NULL OR length(rs) < 3 THEN RAISE EXCEPTION 'Informe o motivo da negativa'; END IF;
    newst := 'recusado';
    UPDATE exchange_requests SET status = 'recusado', requires_human_review = false, decided_by = uid, decided_at = now(), decision_reason = rs, reviewed_by = nm, reviewed_at = now(), replacement_reserved_quantity = 0, updated_at = now() WHERE id = p_id;
  ELSIF p_action = 'request_info' THEN
    IF e.status NOT IN ('escalado','solicitado') THEN RAISE EXCEPTION 'Esta solicitação já foi decidida'; END IF;
    UPDATE exchange_requests SET desk_info_requested_at = now(), updated_at = now() WHERE id = p_id;
  ELSIF p_action = 'offer_size' OR p_action = 'note' OR p_action = 'open_whatsapp' THEN
    NULL;
  ELSIF p_action = 'link_troca' THEN
    IF e.status NOT IN ('aprovado','aguardando_postagem','em_transito','recebido') THEN RAISE EXCEPTION 'Só solicitação aprovada vira registro de troca'; END IF;
    IF e.trocas_devolucoes_id IS NOT NULL THEN RAISE EXCEPTION 'Esta solicitação já tem registro de troca'; END IF;
    IF p_troca_id IS NULL OR NOT EXISTS (SELECT 1 FROM trocas_devolucoes WHERE id = p_troca_id AND pedido_original_id = e.sale_id) THEN RAISE EXCEPTION 'Registro de troca inválido'; END IF;
    UPDATE exchange_requests SET trocas_devolucoes_id = p_troca_id, updated_at = now() WHERE id = p_id;
  ELSIF p_action = 'set_reverse' THEN
    IF e.status <> 'aprovado' THEN RAISE EXCEPTION 'Reversa só para solicitação aprovada'; END IF;
    IF e.reverse_shipping_code IS NOT NULL THEN RAISE EXCEPTION 'Esta solicitação já tem reversa'; END IF;
    IF p_code IS NULL OR p_code !~ '^[A-Z0-9]{6,20}$' THEN RAISE EXCEPTION 'Código de postagem inválido'; END IF;
    newst := 'aguardando_postagem';
    UPDATE exchange_requests SET reverse_shipping_code = p_code, status = 'aguardando_postagem', updated_at = now() WHERE id = p_id;
  ELSE
    RAISE EXCEPTION 'Ação inválida';
  END IF;
  INSERT INTO exchange_request_events (request_id, actor, actor_name, action, from_status, to_status, reason, note)
  VALUES (p_id, uid, nm, p_action, e.status::text, newst, rs, coalesce(nt, CASE WHEN p_action='set_reverse' THEN p_code END));
  RETURN jsonb_build_object('ok', true, 'status', newst);
END $$;
REVOKE ALL ON FUNCTION public.exchange_desk_action(uuid,text,text,text,uuid,text,uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.exchange_desk_action(uuid,text,text,text,uuid,text,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.exchange_desk_staff_list() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE r jsonb;
BEGIN
  IF NOT public._exchange_desk_staff(auth.uid()) THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',u.id,'name',coalesce(u.raw_user_meta_data->>'full_name',u.raw_user_meta_data->>'name',u.email))),'[]') INTO r
  FROM (SELECT * FROM auth.users u WHERE public._exchange_desk_staff(u.id) ORDER BY u.email LIMIT 200) u;
  RETURN r;
END $$;
REVOKE ALL ON FUNCTION public.exchange_desk_staff_list() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.exchange_desk_staff_list() TO authenticated;

DROP POLICY IF EXISTS "Authenticated users can manage exchange_requests" ON public.exchange_requests;
CREATE POLICY "Staff manages exchange_requests" ON public.exchange_requests FOR ALL TO authenticated USING (public._exchange_desk_staff(auth.uid())) WITH CHECK (public._exchange_desk_staff(auth.uid()));