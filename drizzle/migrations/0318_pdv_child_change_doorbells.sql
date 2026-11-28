CREATE OR REPLACE FUNCTION public.pdv_sale_child_doorbell() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE ids uuid[]; sid uuid; field text := TG_ARGV[0]; BEGIN
IF TG_OP='INSERT' THEN SELECT array_agg(DISTINCT (to_jsonb(n)->>field)::uuid) INTO ids FROM new_rows n WHERE (to_jsonb(n)->>field) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
ELSIF TG_OP='DELETE' THEN SELECT array_agg(DISTINCT (to_jsonb(o)->>field)::uuid) INTO ids FROM old_rows o WHERE (to_jsonb(o)->>field) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
ELSE SELECT array_agg(DISTINCT id::uuid) INTO ids FROM (SELECT to_jsonb(n)->>field id FROM new_rows n JOIN old_rows o USING(id) WHERE n IS DISTINCT FROM o UNION SELECT to_jsonb(o)->>field FROM old_rows o JOIN new_rows n USING(id) WHERE n IS DISTINCT FROM o) x WHERE id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'; END IF;
IF ids IS NULL THEN RETURN NULL; END IF;
FOR sid IN SELECT DISTINCT store_id FROM public.pos_sales WHERE id=ANY(ids) LOOP PERFORM realtime.send('{}'::jsonb,'sales_changed','pdv-store:'||sid::text,true); END LOOP; RETURN NULL; END; $$;
REVOKE ALL ON FUNCTION public.pdv_sale_child_doorbell() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER pdv_items_insert AFTER INSERT ON public.pos_sale_items REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.pdv_sale_child_doorbell('sale_id');
CREATE TRIGGER pdv_items_update AFTER UPDATE ON public.pos_sale_items REFERENCING NEW TABLE AS new_rows OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION public.pdv_sale_child_doorbell('sale_id');
CREATE TRIGGER pdv_items_delete AFTER DELETE ON public.pos_sale_items REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION public.pdv_sale_child_doorbell('sale_id');
CREATE TRIGGER pdv_checkout_insert AFTER INSERT ON public.pos_checkout_attempts REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.pdv_sale_child_doorbell('sale_id');
CREATE TRIGGER pdv_checkout_update AFTER UPDATE ON public.pos_checkout_attempts REFERENCING NEW TABLE AS new_rows OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION public.pdv_sale_child_doorbell('sale_id');
CREATE TRIGGER pdv_checkout_delete AFTER DELETE ON public.pos_checkout_attempts REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION public.pdv_sale_child_doorbell('sale_id');
CREATE TRIGGER pdv_fiscal_insert AFTER INSERT ON public.fiscal_documents REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.pdv_sale_child_doorbell('pos_sale_id');
CREATE TRIGGER pdv_fiscal_update AFTER UPDATE ON public.fiscal_documents REFERENCING NEW TABLE AS new_rows OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION public.pdv_sale_child_doorbell('pos_sale_id');
CREATE TRIGGER pdv_fiscal_delete AFTER DELETE ON public.fiscal_documents REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION public.pdv_sale_child_doorbell('pos_sale_id');