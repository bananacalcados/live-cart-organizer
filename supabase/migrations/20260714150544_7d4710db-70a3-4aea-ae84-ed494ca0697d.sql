CREATE OR REPLACE FUNCTION public.vip_group_member_phone_suffixes()
RETURNS text[]
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH vip_groups AS (
    SELECT g.id, g.group_id
    FROM public.whatsapp_groups g
    WHERE g.is_vip = true
       OR g.id IN (
         SELECT DISTINCT unnest(gc.target_groups)::uuid
         FROM public.group_campaigns gc
         WHERE gc.target_groups IS NOT NULL
           AND array_length(gc.target_groups, 1) > 0
       )
  )
  SELECT COALESCE(array_agg(DISTINCT right(regexp_replace(m.phone, '\D', '', 'g'), 8)), ARRAY[]::text[])
  FROM public.whatsapp_group_members m
  JOIN vip_groups vg
    ON regexp_replace(vg.group_id, '[^0-9]', '', 'g') = regexp_replace(m.group_id, '[^0-9]', '', 'g')
  WHERE m.phone IS NOT NULL
    AND length(regexp_replace(m.phone, '\D', '', 'g')) >= 8
    AND (m.left_at IS NULL);
$function$;