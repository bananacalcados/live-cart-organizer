-- Índices por sufixo (DDD + 8 dígitos) — expressão imutável, barata nas tabelas pequenas.
CREATE INDEX IF NOT EXISTS idx_customers_whatsapp_suffix8
  ON public.customers ((right(regexp_replace(coalesce(whatsapp,''), '\D', '', 'g'), 8)))
  WHERE whatsapp IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_customer_registrations_whatsapp_suffix8
  ON public.customer_registrations ((right(regexp_replace(coalesce(whatsapp,''), '\D', '', 'g'), 8)))
  WHERE whatsapp IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_chat_contacts_phone_suffix8
  ON public.chat_contacts ((right(regexp_replace(coalesce(phone,''), '\D', '', 'g'), 8)))
  WHERE phone IS NOT NULL;

CREATE OR REPLACE FUNCTION public.live_resolve_contact_identities(p_suffixes text[])
RETURNS TABLE (suffix8 text, name text, instagram_handle text, source text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH s AS (
    SELECT DISTINCT right(regexp_replace(coalesce(x,''), '\D', '', 'g'), 8) AS sfx
    FROM unnest(coalesce(p_suffixes, '{}'::text[])) AS x
    WHERE length(regexp_replace(coalesce(x,''), '\D', '', 'g')) >= 8
  ),
  cand AS (
    -- 1) Clientes da Live
    SELECT s.sfx, nullif(btrim(c.full_name),'') AS name, nullif(btrim(c.instagram_handle),'') AS handle,
           'live_customer'::text AS src, 1 AS prio, c.updated_at AS ts
    FROM s JOIN public.customers c
      ON right(regexp_replace(coalesce(c.whatsapp,''), '\D', '', 'g'), 8) = s.sfx
    WHERE c.whatsapp IS NOT NULL
    UNION ALL
    -- 2) Base CRM unificada
    SELECT s.sfx, nullif(btrim(u.name),''), nullif(btrim(u.instagram_handle),''),
           'crm', 2, u.updated_at
    FROM s JOIN public.customers_unified u ON u.phone_suffix8 = s.sfx
    WHERE coalesce(u.is_archived,false) = false
    UNION ALL
    -- 3) Cadastros de checkout
    SELECT s.sfx, nullif(btrim(r.full_name),''), NULL,
           'registration', 3, r.updated_at
    FROM s JOIN public.customer_registrations r
      ON right(regexp_replace(coalesce(r.whatsapp,''), '\D', '', 'g'), 8) = s.sfx
    WHERE r.whatsapp IS NOT NULL
    UNION ALL
    -- 4) Leads de eventos (qualquer evento)
    SELECT s.sfx, nullif(btrim(l.name),''), NULL,
           'event_lead', 4, l.created_at
    FROM s JOIN public.event_leads l ON l.phone_suffix = s.sfx
    WHERE l.name IS NOT NULL AND l.name !~* '^lead whatsapp$'
    UNION ALL
    -- 5) Contatos do WhatsApp
    SELECT s.sfx, nullif(btrim(coalesce(cc.custom_name, cc.display_name)),''), NULL,
           'chat_contact', 5, cc.updated_at
    FROM s JOIN public.chat_contacts cc
      ON right(regexp_replace(coalesce(cc.phone,''), '\D', '', 'g'), 8) = s.sfx
    WHERE cc.phone IS NOT NULL
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
$$;

REVOKE ALL ON FUNCTION public.live_resolve_contact_identities(text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.live_resolve_contact_identities(text[]) TO authenticated, service_role;