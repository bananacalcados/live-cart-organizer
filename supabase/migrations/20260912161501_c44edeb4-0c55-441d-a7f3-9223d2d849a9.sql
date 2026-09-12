CREATE OR REPLACE FUNCTION public.live_resolve_contact_identities(p_suffixes text[], p_phones text[] DEFAULT NULL)
 RETURNS TABLE(suffix8 text, name text, instagram_handle text, source text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH s AS (
    SELECT DISTINCT right(regexp_replace(coalesce(x,''), '\D', '', 'g'), 8) AS sfx
    FROM unnest(coalesce(p_suffixes, '{}'::text[])) AS x
    WHERE length(regexp_replace(coalesce(x,''), '\D', '', 'g')) >= 8
  ),
  wa AS (
    SELECT DISTINCT ON (right(regexp_replace(m.phone, '\D', '', 'g'), 8))
           right(regexp_replace(m.phone, '\D', '', 'g'), 8) AS sfx,
           nullif(btrim(m.sender_name),'') AS name,
           m.created_at AS ts
    FROM public.whatsapp_messages m
    WHERE p_phones IS NOT NULL
      AND m.phone = ANY(p_phones)
      AND m.direction = 'incoming'
      AND m.sender_name IS NOT NULL
      AND btrim(m.sender_name) <> ''
      AND m.sender_name !~ '^\+?\d[\d\s\-\(\)]*$'
    ORDER BY right(regexp_replace(m.phone, '\D', '', 'g'), 8), m.created_at DESC
  ),
  cand AS (
    SELECT s.sfx, nullif(btrim(c.full_name),'') AS name, nullif(btrim(c.instagram_handle),'') AS handle,
           'live_customer'::text AS src, 1 AS prio, c.updated_at AS ts
    FROM s JOIN public.customers c
      ON right(regexp_replace(coalesce(c.whatsapp,''), '\D', '', 'g'), 8) = s.sfx
    WHERE c.whatsapp IS NOT NULL
    UNION ALL
    SELECT s.sfx, nullif(btrim(u.name),''), nullif(btrim(u.instagram_handle),''),
           'crm', 2, u.updated_at
    FROM s JOIN public.customers_unified u ON u.phone_suffix8 = s.sfx
    WHERE coalesce(u.is_archived,false) = false
    UNION ALL
    SELECT s.sfx, nullif(btrim(r.full_name),''), NULL,
           'registration', 3, r.updated_at
    FROM s JOIN public.customer_registrations r
      ON right(regexp_replace(coalesce(r.whatsapp,''), '\D', '', 'g'), 8) = s.sfx
    WHERE r.whatsapp IS NOT NULL
    UNION ALL
    SELECT s.sfx, nullif(btrim(cc.custom_name),''), NULL,
           'chat_contact_custom', 4, cc.updated_at
    FROM s JOIN public.chat_contacts cc
      ON right(regexp_replace(coalesce(cc.phone,''), '\D', '', 'g'), 8) = s.sfx
    WHERE cc.phone IS NOT NULL
    UNION ALL
    -- Nome que a própria cliente configurou no WhatsApp (push name do contato)
    SELECT s.sfx, nullif(btrim(cc.display_name),''), NULL,
           'whatsapp_profile', 5, cc.updated_at
    FROM s JOIN public.chat_contacts cc
      ON right(regexp_replace(coalesce(cc.phone,''), '\D', '', 'g'), 8) = s.sfx
    WHERE cc.phone IS NOT NULL
    UNION ALL
    -- Nome do perfil do WhatsApp vindo nas mensagens recebidas
    SELECT s.sfx, wa.name, NULL, 'whatsapp_push', 6, wa.ts
    FROM s JOIN wa ON wa.sfx = s.sfx
    UNION ALL
    SELECT s.sfx, nullif(btrim(l.name),''), NULL,
           'event_lead', 7, l.created_at
    FROM s JOIN public.event_leads l ON l.phone_suffix = s.sfx
    WHERE l.name IS NOT NULL AND l.name !~* '^lead whatsapp$'
  ),
  best_name AS (
    SELECT DISTINCT ON (sfx) sfx, name, src
    FROM cand
    WHERE name IS NOT NULL
    ORDER BY sfx, prio, ts DESC NULLS LAST
  ),
  best_handle AS (
    SELECT DISTINCT ON (sfx) sfx, handle
    FROM cand
    WHERE handle IS NOT NULL AND handle !~* '^@?teste?$'
    ORDER BY sfx, prio, ts DESC NULLS LAST
  )
  SELECT s.sfx, bn.name, bh.handle, bn.src
  FROM s
  LEFT JOIN best_name bn ON bn.sfx = s.sfx
  LEFT JOIN best_handle bh ON bh.sfx = s.sfx
  WHERE bn.name IS NOT NULL OR bh.handle IS NOT NULL;
$function$;