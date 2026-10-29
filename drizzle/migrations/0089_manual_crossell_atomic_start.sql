CREATE OR REPLACE FUNCTION public.start_manual_crossell(p_id uuid,p_event uuid,p_order uuid,p_phone text,p_instance uuid,p_user uuid,p_name text,p_blocks jsonb) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_existing public.event_bulk_sends;
BEGIN
PERFORM pg_advisory_xact_lock(hashtextextended(p_id::text,0));
SELECT * INTO v_existing FROM public.event_bulk_sends WHERE id=p_id;
IF FOUND THEN
IF NOT v_existing.manual_blocks OR v_existing.created_by IS DISTINCT FROM p_user OR v_existing.event_id IS DISTINCT FROM p_event OR v_existing.whatsapp_number_id IS DISTINCT FROM p_instance THEN RAISE EXCEPTION 'Execução incompatível'; END IF;
RETURN p_id;
END IF;
INSERT INTO public.event_bulk_sends(id,event_id,kind,template_name,template_label,whatsapp_number_id,manual_blocks,base_components,created_by,status,total_count) VALUES(p_id,p_event,'crossell','manual_blocks',p_name,p_instance,true,p_blocks,p_user,'processing',1);
INSERT INTO public.event_bulk_send_items(send_id,order_id,phone,whatsapp_number_id,crossell_state) VALUES(p_id,p_order,p_phone,p_instance,'pending');
RETURN p_id;
END; $$;
REVOKE ALL ON FUNCTION public.start_manual_crossell(uuid,uuid,uuid,text,uuid,uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.start_manual_crossell(uuid,uuid,uuid,text,uuid,uuid,text,jsonb) TO service_role;