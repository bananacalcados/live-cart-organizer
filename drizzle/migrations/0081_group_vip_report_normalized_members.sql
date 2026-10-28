DO $patch$
DECLARE body text;
BEGIN
body := pg_get_functiondef('public.refresh_vip_orphans()'::regprocedure);
body := replace(body, $$regexp_replace(g.group_id,'\D','','g')$$, 'g.group_jid_base');
body := replace(body, $$regexp_replace(m.group_id,'\D','','g')$$, 'm.group_jid_base');
body := replace(body, 'FROM public.whatsapp_groups g JOIN vip_group_ids v ON v.gid = g.id', 'FROM public.whatsapp_groups g WHERE g.is_vip = true');
EXECUTE body;
END;
$patch$;
CREATE OR REPLACE FUNCTION public.inherit_group_manual_vip() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
BEGIN
NEW.is_vip := COALESCE((SELECT g.is_vip FROM public.whatsapp_groups g WHERE g.group_jid_base=NEW.group_jid_base LIMIT 1),false);
RETURN NEW;
END; $$;
CREATE TRIGGER trg_inherit_group_manual_vip BEFORE INSERT ON public.whatsapp_groups FOR EACH ROW EXECUTE FUNCTION public.inherit_group_manual_vip();