CREATE OR REPLACE FUNCTION public.manual_crossell_dispatch_allowed(p_item uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_send uuid; v_status text; v_state text;
BEGIN
SELECT send_id INTO v_send FROM public.event_bulk_send_items WHERE id=p_item;
SELECT status INTO v_status FROM public.event_bulk_sends WHERE id=v_send FOR UPDATE;
SELECT crossell_state INTO v_state FROM public.event_bulk_send_items WHERE id=p_item FOR UPDATE;
IF v_status='cancelled' THEN
UPDATE public.event_bulk_send_items SET crossell_state='cancelled',status='skipped' WHERE id=p_item AND crossell_state IS DISTINCT FROM 'cancelled';
RETURN false;
END IF;
RETURN v_status IN ('queued','processing') AND v_state='sending';
END; $$;
REVOKE ALL ON FUNCTION public.manual_crossell_dispatch_allowed(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.manual_crossell_dispatch_allowed(uuid) TO service_role;