CREATE OR REPLACE FUNCTION public.create_support_link(p_order_ref text,p_request_type text,p_created_by_kind text,p_customer_phone text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE v_token text; v_id uuid; v_exp timestamptz; v_sale uuid;
BEGIN
IF auth.role() IS DISTINCT FROM 'service_role' AND NOT (has_role(auth.uid(),'admin') OR has_module_access(auth.uid(),'pos') OR has_module_access(auth.uid(),'expedition')) THEN RAISE EXCEPTION 'forbidden'; END IF;
IF p_order_ref IS NULL OR p_order_ref !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' OR p_request_type NOT IN ('troca','devolucao') OR p_created_by_kind NOT IN ('ai','agent','system') THEN RAISE EXCEPTION 'invalid'; END IF;
SELECT id INTO v_sale FROM pos_sales WHERE id=p_order_ref::uuid;
IF v_sale IS NULL THEN RAISE EXCEPTION 'pedido indisponivel'; END IF;
v_token:=translate(encode(extensions.gen_random_bytes(32),'base64'),'+/=','-_');
INSERT INTO support_links(token_hash,order_ref,request_type,created_by_kind,created_by_user) VALUES(encode(extensions.digest(v_token,'sha256'),'hex'),v_sale::text,p_request_type,p_created_by_kind,auth.uid()) RETURNING id,expires_at INTO v_id,v_exp;
RETURN jsonb_build_object('id',v_id,'token',v_token,'expires_at',v_exp,'url','https://checkout.bananacalcados.com.br/central/'||p_request_type||'/'||v_token);
END $$;
REVOKE ALL ON FUNCTION public.create_support_link(text,text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_support_link(text,text,text,text) TO authenticated,service_role;
CREATE OR REPLACE FUNCTION public.central_revoke_link(p_id uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
IF NOT (has_role(auth.uid(),'admin') OR has_module_access(auth.uid(),'pos') OR has_module_access(auth.uid(),'expedition')) THEN RAISE EXCEPTION 'forbidden'; END IF;
UPDATE support_links SET revoked_at=now() WHERE id=p_id AND revoked_at IS NULL;
RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION public.central_revoke_link(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.central_revoke_link(uuid) TO authenticated;