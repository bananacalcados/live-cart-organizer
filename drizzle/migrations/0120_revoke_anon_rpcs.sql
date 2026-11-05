-- Fase 3 item 4: anon só executa as funções das páginas públicas.
DO $$
DECLARE f record;
BEGIN
  FOR f IN
    SELECT p.oid, p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
  LOOP
    IF has_function_privilege('authenticated', f.oid, 'EXECUTE') THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f.sig);
    END IF;
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f.sig);
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', f.sig);
  END LOOP;
END $$;

ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO authenticated, service_role;

-- Funções perigosas sem uso por tela logada: só service_role.
DO $$
DECLARE n text;
BEGIN
  FOREACH n IN ARRAY ARRAY['public.analyze_catalog_sync_from_pos','public.apply_event_prize_to_order','public.apply_variant_normalization','public.backfill_estoque_from_pos','public.backfill_phones_from_pos_customers','public.delete_pos_divergent_parent','public.execute_merge_unified_duplicates','public.inventory_claim_correction_batch','public.merge_duplicate_zoppy_customers','public.merge_master_duplicates','public.merge_product_color','public.merge_product_size','public.merge_selected_masters','public.merge_tiny_online_duplicates','public.merge_unified_zoppy_duplicates','public.resolve_customer_unified','public.resolve_payment_fee','public.revert_merge_batch','public.simulate_merge_unified_duplicates','public.sync_lead_pix_data','public.unified_inventory_apply_nfe_entry','public.apply_split_payment'] LOOP
    EXECUTE coalesce((SELECT string_agg(format('REVOKE EXECUTE ON FUNCTION %s FROM authenticated', p.oid::regprocedure), '; ')
             FROM pg_proc p WHERE p.proname = split_part(n,'.',2) AND p.pronamespace = 'public'::regnamespace), 'SELECT 1');
  END LOOP;
END $$;

-- Lista explícita das que continuam públicas (páginas sem login, regras de acesso e valores padrão).
DO $$
DECLARE n text;
BEGIN
  FOREACH n IN ARRAY ARRAY['dispatch_link_click','generate_ean13_internal','get_checkout_order','get_checkout_registration','get_customer_checkout_prefill','get_event_checkout_shipping','get_event_installment_config','get_latest_registration_by_customer','get_order_status','get_registration_by_cpf','get_sale_installment_override','has_module_access','has_role','increment_campaign_leads_captured','next_product_sku_root','normalize_address_key','overlay_pull','overlay_shown_products','upsert_landing_customer'] LOOP
    EXECUTE coalesce((SELECT string_agg(format('GRANT EXECUTE ON FUNCTION %s TO anon', p.oid::regprocedure), '; ')
             FROM pg_proc p WHERE p.proname = n AND p.pronamespace = 'public'::regnamespace), 'SELECT 1');
  END LOOP;
END $$;

-- Fila "Por código": só equipe com acesso ao módulo de eventos.
CREATE OR REPLACE FUNCTION public.resolve_live_order_intent(p_intent_id uuid, p_action text, p_by text DEFAULT NULL::text, p_order_id uuid DEFAULT NULL::uuid)
 RETURNS live_order_intents LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare r live_order_intents;
begin
  if auth.uid() is not null and not public.has_module_access(auth.uid(), 'events') then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  if p_action = 'confirm' then
    update live_order_intents set status='confirmed', confirmed_by=p_by, confirmed_at=now(), order_id=coalesce(p_order_id, order_id),
      items = (select coalesce(jsonb_agg(e || '{"status":"confirmed"}'::jsonb),'[]'::jsonb) from jsonb_array_elements(items) e), updated_at=now()
    where id = p_intent_id returning * into r;
  elsif p_action = 'dismiss' then
    update live_order_intents set status='dismissed', confirmed_by=p_by, confirmed_at=now(), updated_at=now()
    where id = p_intent_id returning * into r;
  elsif p_action = 'reopen' then
    update live_order_intents set status='incomplete', confirmed_by=null, confirmed_at=null, updated_at=now()
    where id = p_intent_id returning * into r;
  else
    raise exception 'ação inválida: %', p_action;
  end if;
  return r;
end $function$;

CREATE OR REPLACE FUNCTION public.update_live_order_intent_item(p_intent_id uuid, p_index integer, p_size text)
 RETURNS live_order_intents LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare r live_order_intents; v product_variants; it jsonb; stk int;
begin
  if auth.uid() is not null and not public.has_module_access(auth.uid(), 'events') then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  select * into r from live_order_intents where id = p_intent_id;
  it := r.items -> p_index;
  if it is null then raise exception 'item não existe'; end if;
  it := it - 'variant_id' - 'sku' - 'shopify_variant_id' - 'stock' || jsonb_build_object('size', p_size, 'warnings', '[]'::jsonb);
  select v2.* into v from product_variants v2 where v2.master_id=(it->>'master_id')::uuid
    and lower(trim(coalesce(v2.color,'')))=lower(trim(coalesce(it->>'color',''))) and trim(v2.size)=trim(p_size) and v2.is_active limit 1;
  if v.id is null then
    it := jsonb_set(it,'{warnings}', to_jsonb(array['tamanho '||p_size||' não existe nessa cor']));
  else
    select coalesce(sum(total_stock),0) into stk from product_variant_stock where variant_id=v.id;
    it := it || jsonb_build_object('variant_id',v.id,'sku',v.sku,'shopify_variant_id',v.shopify_variant_id,'stock',stk);
    if stk<=0 then it := jsonb_set(it,'{warnings}', to_jsonb(array['sem estoque'])); end if;
  end if;
  update live_order_intents set items = jsonb_set(items, array[p_index::text], it),
    status = case when status in ('confirmed','dismissed') then status else 'ready' end, updated_at=now()
  where id = p_intent_id returning * into r;
  return r;
end $function$;

REVOKE EXECUTE ON FUNCTION public.resolve_live_order_intent(uuid, text, text, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.update_live_order_intent_item(uuid, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_live_order_intent(uuid, text, text, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_live_order_intent_item(uuid, integer, text) TO authenticated, service_role;

-- Etiquetas visuais: leitura pública, escrita só admin (e service_role, que ignora RLS).
DROP POLICY IF EXISTS "Service role can manage visual tags" ON public.product_visual_tags;
CREATE POLICY "Admins manage visual tags" ON public.product_visual_tags
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
