-- RPC helper: distinct 8-digit phone suffixes of members of any VIP group.
-- Used by Marketing > Disparos to include/exclude contacts that already
-- belong to a VIP group. Returns a plain text[] so the frontend can build
-- a Set for O(1) suffix lookups against CRM/leads phones.
CREATE OR REPLACE FUNCTION public.vip_group_member_phone_suffixes()
RETURNS text[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(array_agg(DISTINCT right(regexp_replace(m.phone, '\D', '', 'g'), 8)), ARRAY[]::text[])
  FROM public.whatsapp_group_members m
  JOIN public.whatsapp_groups g ON g.group_id = m.group_id
  WHERE g.is_vip = true
    AND m.phone IS NOT NULL
    AND length(regexp_replace(m.phone, '\D', '', 'g')) >= 8;
$$;

REVOKE ALL ON FUNCTION public.vip_group_member_phone_suffixes() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.vip_group_member_phone_suffixes() TO authenticated, service_role;