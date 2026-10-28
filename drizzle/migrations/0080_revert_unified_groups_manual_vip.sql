DROP VIEW IF EXISTS public.whatsapp_groups_unified;
ALTER TABLE public.whatsapp_groups ALTER COLUMN is_vip SET DEFAULT false;
CREATE OR REPLACE VIEW public.vip_group_membership_stats WITH (security_invoker = on) AS
WITH vip_groups AS (SELECT g.id,g.name,g.group_jid_base AS digits FROM public.whatsapp_groups g WHERE g.is_vip=true), member_class AS (
SELECT DISTINCT m.group_jid_base AS digits,right(regexp_replace(m.phone,'\D','','g'),8) AS s8,
CASE WHEN m.customer_id IS NOT NULL THEN 'customer'
WHEN EXISTS(SELECT 1 FROM public.customers_unified c WHERE c.phone_suffix8=right(regexp_replace(m.phone,'\D','','g'),8)) THEN 'customer'
WHEN EXISTS(SELECT 1 FROM public.event_leads e WHERE right(regexp_replace(coalesce(e.phone,''),'\D','','g'),8)=right(regexp_replace(m.phone,'\D','','g'),8))
OR EXISTS(SELECT 1 FROM public.lp_leads l WHERE right(regexp_replace(coalesce(l.phone,''),'\D','','g'),8)=right(regexp_replace(m.phone,'\D','','g'),8))
OR EXISTS(SELECT 1 FROM public.ad_leads a WHERE right(regexp_replace(coalesce(a.phone,''),'\D','','g'),8)=right(regexp_replace(m.phone,'\D','','g'),8))
OR EXISTS(SELECT 1 FROM public.link_page_leads k WHERE right(regexp_replace(coalesce(k.phone,''),'\D','','g'),8)=right(regexp_replace(m.phone,'\D','','g'),8)) THEN 'lead' ELSE 'orphan' END AS klass
FROM public.whatsapp_group_members m WHERE m.status='member' AND length(regexp_replace(m.phone,'\D','','g'))>=12)
SELECT vg.id AS group_id,vg.name AS group_name,count(mc.s8) AS total_members,count(mc.s8) FILTER(WHERE mc.klass='customer') AS customers,count(mc.s8) FILTER(WHERE mc.klass='lead') AS leads,count(mc.s8) FILTER(WHERE mc.klass='orphan') AS orphans FROM vip_groups vg LEFT JOIN member_class mc ON mc.digits=vg.digits GROUP BY vg.id,vg.name;
GRANT SELECT ON public.vip_group_membership_stats TO authenticated,service_role;
CREATE OR REPLACE FUNCTION public.mirror_group_manual_vip() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
BEGIN
IF pg_trigger_depth()>1 OR NEW.group_jid_base IS NULL THEN RETURN NEW; END IF;
UPDATE public.whatsapp_groups SET is_vip=NEW.is_vip WHERE group_jid_base=NEW.group_jid_base AND id<>NEW.id AND is_vip IS DISTINCT FROM NEW.is_vip;
RETURN NEW;
END; $$;
CREATE TRIGGER trg_mirror_group_manual_vip AFTER UPDATE OF is_vip ON public.whatsapp_groups FOR EACH ROW WHEN(OLD.is_vip IS DISTINCT FROM NEW.is_vip) EXECUTE FUNCTION public.mirror_group_manual_vip();
CREATE OR REPLACE FUNCTION public.record_whatsapp_group_snapshot() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE last_rec timestamptz; last_count integer;
BEGIN
IF NEW.participant_count IS NULL THEN RETURN NEW; END IF;
SELECT recorded_at,participant_count INTO last_rec,last_count FROM public.whatsapp_group_snapshots WHERE group_id=NEW.id ORDER BY recorded_at DESC LIMIT 1;
IF last_rec IS NOT NULL AND last_count=NEW.participant_count AND last_rec>now()-interval '1 hour' THEN RETURN NEW; END IF;
INSERT INTO public.whatsapp_group_snapshots(group_id,group_jid_base,participant_count) VALUES(NEW.id,NEW.group_jid_base,NEW.participant_count);
RETURN NEW;
END; $$;
DO $patch$
DECLARE fn regprocedure; body text;
BEGIN
fn:='public.vip_link_funnel(integer)'::regprocedure;
body:=pg_get_functiondef(fn);
body:=replace(body,$$regexp_replace(wg.group_id, '\D', '', 'g')$$,'wg.group_jid_base');
body:=replace(body,'JOIN whatsapp_groups wg ON wg.id = ANY (gc.target_groups)','JOIN whatsapp_groups wg ON wg.id = ANY (gc.target_groups) AND wg.is_vip = true');
body:=replace(body,'m.group_id = cg_d.gdig','m.group_jid_base = cg_d.gdig');
EXECUTE body;
fn:='public.bc_match_audience(public.crm_customers_v,jsonb,jsonb)'::regprocedure;
body:=replace(pg_get_functiondef(fn),'g.group_id = m.group_id','g.group_jid_base = m.group_jid_base');
EXECUTE body;
FOREACH fn IN ARRAY ARRAY['public.vip_groups_interaction_ranking(integer)'::regprocedure,'public.vip_groups_sales_ranking(integer,integer)'::regprocedure,'public.vip_leads_ranking(integer,integer)'::regprocedure] LOOP
body:=pg_get_functiondef(fn);
body:=replace(body,$$regexp_replace(g.group_id, '\D', '', 'g')$$,'g.group_jid_base');
body:=replace(body,$$regexp_replace(group_id, '\D', '', 'g')$$,'group_jid_base');
body:=replace(body,'WHERE g.is_active','WHERE g.is_active AND g.is_vip = true');
body:=replace(body,'FROM whatsapp_group_member_activity','FROM whatsapp_group_member_activity a');
body:=replace(body,'WHERE NOT is_internal','WHERE EXISTS (SELECT 1 FROM public.whatsapp_groups vg WHERE vg.group_jid_base = a.group_jid_base AND vg.is_vip = true) AND NOT is_internal');
EXECUTE body;
END LOOP;
END; $patch$;
CREATE OR REPLACE FUNCTION public.vip_groups_overview() RETURNS TABLE(total_groups bigint,total_members bigint,total_memberships bigint,total_activities bigint,groups_with_activity bigint) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
SELECT
(SELECT count(*) FROM whatsapp_groups WHERE is_active AND is_vip=true),
(SELECT count(DISTINCT m.phone) FROM whatsapp_group_members m WHERE m.status='member' AND NOT m.is_internal AND EXISTS(SELECT 1 FROM whatsapp_groups g WHERE g.group_jid_base=m.group_jid_base AND g.is_vip=true)),
(SELECT count(*) FROM whatsapp_group_members m WHERE m.status='member' AND NOT m.is_internal AND EXISTS(SELECT 1 FROM whatsapp_groups g WHERE g.group_jid_base=m.group_jid_base AND g.is_vip=true)),
(SELECT count(*) FROM whatsapp_group_member_activity a WHERE NOT a.is_internal AND EXISTS(SELECT 1 FROM whatsapp_groups g WHERE g.group_jid_base=a.group_jid_base AND g.is_vip=true)),
(SELECT count(DISTINCT a.group_jid_base) FROM whatsapp_group_member_activity a WHERE NOT a.is_internal AND EXISTS(SELECT 1 FROM whatsapp_groups g WHERE g.group_jid_base=a.group_jid_base AND g.is_vip=true)); $$;